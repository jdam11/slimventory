from __future__ import annotations

import fnmatch
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy.orm import Session

from app.models.git import AnsiblePlaybook
from app.models.job_templates import JobTemplate, JobTemplatePreviewCache
from app.schemas.job_templates import (
    JobTemplatePreviewHostRead,
    JobTemplatePreviewPlayHostMatchRead,
    JobTemplatePreviewPlayRead,
    JobTemplatePreviewRead,
    JobTemplatePreviewTaskRead,
)
from app.services.git_service import get_repo_commit_sha, get_repo_path
from app.services.inventory_builder import (
    get_filtered_inventory_rows,
    normalize_inventory_filters_for_template,
)


def _sha(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def _template_fingerprint(template: JobTemplate) -> str:
    return _sha(
        {
            "playbook_id": template.playbook_id,
            "inventory_filter_type": template.inventory_filter_type.value,
            "inventory_filter_value": template.inventory_filter_value,
            "inventory_filters": normalize_inventory_filters_for_template(
                template.inventory_filter_type,
                template.inventory_filter_value,
                template.inventory_filters,
            ),
            "extra_vars": template.extra_vars,
            "updated_at": template.updated_at.isoformat() if template.updated_at else None,
        }
    )


def _host_groups(row: dict[str, Any]) -> list[str]:
    groups: list[str] = ["all"]
    if row.get("env"):
        groups.append(f"env_{_slug(str(row['env']))}")
    if row.get("type"):
        groups.append(f"type_{_slug(str(row['type']))}")
    if row.get("status"):
        groups.append(f"status_{_slug(str(row['status']))}")
    if row.get("vlan_id") is not None:
        groups.append(f"vlan_{_slug(str(row['vlan_id']))}")
    if row.get("k3s_cluster"):
        groups.append(f"k3s_{_slug(str(row['k3s_cluster']))}")
    if row.get("vm_storage_os_datastore"):
        groups.append(f"ds_os_{_slug(str(row['vm_storage_os_datastore']))}")
    if row.get("vm_storage_hdd01_datastore"):
        groups.append(f"ds_hdd01_{_slug(str(row['vm_storage_hdd01_datastore']))}")
    for role_name in _split_csv(row.get("role")):
        groups.append(f"role_{_slug(role_name)}")
    for app_name in _split_csv(row.get("apps")):
        groups.append(f"app_{_slug(app_name)}")
    return groups


def _split_csv(value: Any) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in str(value).split(",") if part.strip()]


def _slug(raw: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in raw.strip().lower())
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    cleaned = cleaned.strip("_")
    return cleaned or "unknown"


def _safe_load_yaml(path: Path) -> Any:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def _normalize_tags(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item is not None]
    return [str(value)]


def _task_name(task: dict[str, Any], fallback: str) -> str:
    raw = task.get("name")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return fallback


def _task_dynamic_reason(task: dict[str, Any]) -> str | None:
    reasons: list[str] = []
    if "when" in task:
        reasons.append(f"Conditional when: {task['when']}")
    if "loop" in task:
        reasons.append("Loop expands at runtime via loop.")
    if "with_items" in task:
        reasons.append("Loop expands at runtime via with_items.")
    if "until" in task:
        reasons.append("Retry or until evaluation happens at runtime.")
    if reasons:
        return " ".join(reasons)
    return None


def _filter_reason(template: JobTemplate, row: dict[str, Any]) -> str:
    filters = normalize_inventory_filters_for_template(
        template.inventory_filter_type,
        template.inventory_filter_value,
        template.inventory_filters,
    )
    reasons: list[str] = []
    if filters["environment_ids"]:
        reasons.append(f"environment={row.get('env')}")
    if filters["role_ids"]:
        reasons.append(f"role={row.get('role')}")
    if filters["status_ids"]:
        reasons.append(f"status={row.get('status')}")
    if filters["vlan_ids"]:
        reasons.append(f"vlan={row.get('vlan_id')}")
    if filters["host_ids"]:
        reasons.append("explicit host selection")
    if filters["pattern"]:
        reasons.append(f"pattern={filters['pattern']}")
    if not reasons:
        return "Included by the template inventory target: all hosts."
    return f"Matched template inventory filters: {', '.join(reasons)}."


def _task_children_from_role(
    repo_path: Path, role_name: str, seen_files: set[Path], reasons: list[str]
) -> list[JobTemplatePreviewTaskRead]:
    role_main = repo_path / "roles" / role_name / "tasks" / "main.yml"
    if not role_main.exists():
        reasons.append(f"Role '{role_name}' has no static tasks/main.yml to preview.")
        return []
    return _parse_task_file(repo_path, role_main, seen_files, reasons)


def _parse_task_file(
    repo_path: Path, path: Path, seen_files: set[Path], reasons: list[str]
) -> list[JobTemplatePreviewTaskRead]:
    resolved = path.resolve()
    if resolved in seen_files:
        reasons.append(f"Skipped recursive include loop at {path.relative_to(repo_path).as_posix()}.")
        return []
    seen_files.add(resolved)
    data = _safe_load_yaml(path) or []
    if not isinstance(data, list):
        reasons.append(f"Expected a task list in {path.relative_to(repo_path).as_posix()}, found non-list YAML.")
        return []
    tasks: list[JobTemplatePreviewTaskRead] = []
    for idx, task in enumerate(data, start=1):
        if not isinstance(task, dict):
            continue
        tasks.append(_task_preview(repo_path, task, path, idx, seen_files, reasons))
    seen_files.remove(resolved)
    return tasks


def _resolve_static_include(base_file: Path, include_target: str) -> Path:
    return (base_file.parent / include_target).resolve()


def _task_preview(
    repo_path: Path,
    task: dict[str, Any],
    source_file: Path,
    index: int,
    seen_files: set[Path],
    reasons: list[str],
) -> JobTemplatePreviewTaskRead:
    rel_source = source_file.relative_to(repo_path).as_posix()
    tags = _normalize_tags(task.get("tags"))
    if "import_tasks" in task and isinstance(task["import_tasks"], str):
        import_path = _resolve_static_include(source_file, task["import_tasks"])
        children = _parse_task_file(repo_path, import_path, seen_files, reasons) if import_path.exists() else []
        if not import_path.exists():
            reasons.append(f"Static import_tasks target not found: {task['import_tasks']} from {rel_source}.")
        return JobTemplatePreviewTaskRead(
            name=_task_name(task, f"import_tasks {task['import_tasks']}"),
            kind="import_tasks",
            source_path=rel_source,
            confidence="direct",
            dynamic_reason="Static import_tasks target could not be resolved." if not import_path.exists() else None,
            tags=tags,
            children=children,
        )
    if "include_tasks" in task and isinstance(task["include_tasks"], str) and "{{" in task["include_tasks"]:
        return JobTemplatePreviewTaskRead(
            name=_task_name(task, f"include_tasks {task['include_tasks']}"),
            kind="include_tasks",
            source_path=rel_source,
            confidence="unknown",
            dynamic_reason=f"include_tasks path is templated and resolves at runtime: {task['include_tasks']}",
            tags=tags,
            children=[],
        )
    if "include_tasks" in task and isinstance(task["include_tasks"], str) and "{{" not in task["include_tasks"]:
        include_path = _resolve_static_include(source_file, task["include_tasks"])
        children = _parse_task_file(repo_path, include_path, seen_files, reasons) if include_path.exists() else []
        if not include_path.exists():
            reasons.append(f"Static include_tasks target not found: {task['include_tasks']} from {rel_source}.")
        return JobTemplatePreviewTaskRead(
            name=_task_name(task, f"include_tasks {task['include_tasks']}"),
            kind="include_tasks",
            source_path=rel_source,
            confidence="dynamic" if "when" in task else "direct",
            dynamic_reason=(
                f"Conditional include_tasks executes at runtime: {task['when']}"
                if "when" in task
                else ("Static include_tasks target could not be resolved." if not include_path.exists() else None)
            ),
            tags=tags,
            children=children,
        )
    if "import_role" in task and isinstance(task["import_role"], dict):
        role_name = task["import_role"].get("name")
        children = _task_children_from_role(repo_path, str(role_name), seen_files, reasons) if role_name else []
        return JobTemplatePreviewTaskRead(
            name=_task_name(task, f"import_role {role_name or 'unknown'}"),
            kind="import_role",
            source_path=rel_source,
            confidence="direct",
            dynamic_reason=None,
            tags=tags,
            children=children,
        )
    if "include_role" in task and isinstance(task["include_role"], dict):
        role_name = task["include_role"].get("name")
        children = _task_children_from_role(repo_path, str(role_name), seen_files, reasons) if role_name else []
        return JobTemplatePreviewTaskRead(
            name=_task_name(task, f"include_role {role_name or 'unknown'}"),
            kind="include_role",
            source_path=rel_source,
            confidence="dynamic",
            dynamic_reason=f"include_role resolves at runtime for role: {role_name or 'unknown'}",
            tags=tags,
            children=children,
        )
    confidence = "dynamic" if any(key in task for key in ("when", "loop", "with_items", "until")) else "direct"
    return JobTemplatePreviewTaskRead(
        name=_task_name(task, f"task {index}"),
        kind="task",
        source_path=rel_source,
        confidence=confidence,
        dynamic_reason=_task_dynamic_reason(task),
        tags=tags,
        children=[],
    )


def _parse_playbook(repo_path: Path, playbook_path: Path, reasons: list[str]) -> list[dict[str, Any]]:
    data = _safe_load_yaml(playbook_path) or []
    if isinstance(data, dict):
        if "import_playbook" in data:
            target = data.get("import_playbook")
            if isinstance(target, str):
                imported = _resolve_static_include(playbook_path, target)
                if imported.exists():
                    return _parse_playbook(repo_path, imported, reasons)
            reasons.append(
                f"Could not statically resolve import_playbook from {playbook_path.relative_to(repo_path).as_posix()}."
            )
            return []
        return [data]
    if not isinstance(data, list):
        reasons.append(f"Expected play list in {playbook_path.relative_to(repo_path).as_posix()}, found non-list YAML.")
        return []
    plays: list[dict[str, Any]] = []
    for item in data:
        if isinstance(item, dict) and "import_playbook" in item and isinstance(item["import_playbook"], str):
            imported = _resolve_static_include(playbook_path, item["import_playbook"])
            if imported.exists():
                plays.extend(_parse_playbook(repo_path, imported, reasons))
            else:
                reasons.append(
                    "Could not statically resolve import_playbook "
                    f"{item['import_playbook']} from {playbook_path.relative_to(repo_path).as_posix()}."
                )
        elif isinstance(item, dict):
            plays.append(item)
    return plays


def _match_hosts(pattern: str, hosts: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str, list[str]]:
    raw = (pattern or "all").strip()
    if raw in {"all", "*"}:
        return hosts, "direct", ["all"]
    if "{{" in raw or "}}" in raw or "&" in raw or "!" in raw:
        return [], "unknown", []
    tokens = [token.strip() for token in raw.replace(",", ":").split(":") if token.strip()]
    matched: dict[int, dict[str, Any]] = {}
    matched_by: dict[int, set[str]] = {}
    matched_groups: dict[int, set[str]] = {}
    for token in tokens:
        token_matches = False
        for host in hosts:
            hostname = host["hostname"]
            groups = host["groups"]
            if token == hostname or fnmatch.fnmatch(hostname, token):
                matched[host["host_id"]] = host
                matched_by.setdefault(host["host_id"], set()).add(token)
                token_matches = True
                continue
            for group in groups:
                if token == group or fnmatch.fnmatch(group, token):
                    matched[host["host_id"]] = host
                    matched_by.setdefault(host["host_id"], set()).add(token)
                    matched_groups.setdefault(host["host_id"], set()).add(group)
                    token_matches = True
                    break
        if not token_matches:
            # leave unmatched token for caller to inspect separately
            pass
    ordered = sorted(matched.values(), key=lambda item: (item["hostname"], item["host_id"]))
    for host in ordered:
        host["matched_by"] = sorted(matched_by.get(host["host_id"], set()))
        host["matched_groups"] = sorted(matched_groups.get(host["host_id"], set()))
    return ordered, "direct", tokens


def generate_job_template_preview(db: Session, template: JobTemplate) -> dict[str, Any]:
    if template.playbook_id is None:
        raise ValueError("Template has no playbook configured")
    playbook = db.get(AnsiblePlaybook, template.playbook_id)
    if playbook is None:
        raise ValueError("Template playbook not found")

    repo_path = get_repo_path(playbook.repo_id)
    playbook_path = repo_path / playbook.path
    commit_sha = get_repo_commit_sha(playbook.repo_id)
    normalized_filters = normalize_inventory_filters_for_template(
        template.inventory_filter_type,
        template.inventory_filter_value,
        template.inventory_filters,
    )
    rows = get_filtered_inventory_rows(
        db,
        template.inventory_filter_type,
        template.inventory_filter_value,
        normalized_filters,
    )
    inventory_hosts = [
        {
            "host_id": int(row["id"]),
            "hostname": str(row["name"]),
            "ipv4": row.get("ipv4"),
            "groups": _host_groups(row),
            "filter_reason": _filter_reason(template, row),
        }
        for row in rows
        if row.get("name") is not None
    ]
    inventory_fingerprint = _sha(
        {
            "filter_type": template.inventory_filter_type.value,
            "filter_value": template.inventory_filter_value,
            "inventory_filters": normalized_filters,
            "hosts": [
                {"id": item["host_id"], "hostname": item["hostname"], "groups": item["groups"]}
                for item in inventory_hosts
            ],
        }
    )
    template_fp = _template_fingerprint(template)
    dynamic_reasons: list[str] = []
    plays_raw = _parse_playbook(repo_path, playbook_path, dynamic_reasons)
    all_targeted: dict[int, dict[str, Any]] = {}
    unmatched_patterns: list[str] = []
    plays: list[JobTemplatePreviewPlayRead] = []
    confidence = "direct"

    for index, play in enumerate(plays_raw, start=1):
        play_name = str(play.get("name") or f"Play {index}")
        hosts_pattern = str(play.get("hosts") or "all")
        matched_hosts, play_confidence, tokens = _match_hosts(hosts_pattern, [dict(item) for item in inventory_hosts])
        if play_confidence != "direct":
            confidence = "unknown"
            dynamic_reasons.append(f"Play '{play_name}' uses a dynamic hosts pattern: {hosts_pattern}")
        elif not matched_hosts and hosts_pattern not in {"all", "*"}:
            unmatched_patterns.append(hosts_pattern)

        role_tasks: list[JobTemplatePreviewTaskRead] = []
        for role_entry in play.get("roles") or []:
            role_name = role_entry if isinstance(role_entry, str) else role_entry.get("role") or role_entry.get("name")
            if not role_name:
                continue
            role_children = _task_children_from_role(repo_path, str(role_name), set(), dynamic_reasons)
            role_tasks.append(
                JobTemplatePreviewTaskRead(
                    name=f"role {role_name}",
                    kind="role",
                    source_path=f"roles/{role_name}/tasks/main.yml",
                    confidence="direct",
                    dynamic_reason=None,
                    tags=_normalize_tags(role_entry.get("tags")) if isinstance(role_entry, dict) else [],
                    children=role_children,
                )
            )

        direct_tasks: list[JobTemplatePreviewTaskRead] = []
        for section in ("pre_tasks", "tasks", "post_tasks", "handlers"):
            section_tasks = play.get(section) or []
            if isinstance(section_tasks, list):
                for task_index, task in enumerate(section_tasks, start=1):
                    if isinstance(task, dict):
                        direct_tasks.append(
                            _task_preview(repo_path, task, playbook_path, task_index, set(), dynamic_reasons)
                        )

        combined_tasks = role_tasks + direct_tasks
        if any(task.confidence != "direct" for task in combined_tasks):
            confidence = "dynamic"
        for host in matched_hosts:
            existing = all_targeted.setdefault(
                host["host_id"],
                {
                    **host,
                    "matched_by": [],
                    "matched_groups": [],
                    "matched_play_names": [],
                },
            )
            existing["matched_by"] = sorted(set(existing.get("matched_by", []) + host.get("matched_by", [])))
            existing["matched_groups"] = sorted(
                set(existing.get("matched_groups", []) + host.get("matched_groups", []))
            )
            existing["matched_play_names"] = sorted(set(existing.get("matched_play_names", []) + [play_name]))

        plays.append(
            JobTemplatePreviewPlayRead(
                name=play_name,
                hosts_pattern=hosts_pattern,
                confidence=play_confidence,  # type: ignore[arg-type]
                matched_host_ids=[host["host_id"] for host in matched_hosts],
                matched_hostnames=[host["hostname"] for host in matched_hosts],
                host_matches=[
                    JobTemplatePreviewPlayHostMatchRead(
                        host_id=host["host_id"],
                        hostname=host["hostname"],
                        matched_by=host.get("matched_by", []),
                        matched_groups=host.get("matched_groups", []),
                        target_reason=(
                            f"Matched hosts pattern '{hosts_pattern}' via groups "
                            f"{', '.join(host.get('matched_groups', []))}."
                            if host.get("matched_groups")
                            else f"Matched hosts pattern '{hosts_pattern}' directly via token(s) "
                            f"{', '.join(host.get('matched_by', []))}."
                        ),
                    )
                    for host in matched_hosts
                ],
                tasks=combined_tasks,
            )
        )

    if any(reason for reason in dynamic_reasons):
        confidence = "dynamic" if confidence == "direct" else confidence

    target_hosts = [
        JobTemplatePreviewHostRead(
            host_id=item["host_id"],
            hostname=item["hostname"],
            ipv4=item.get("ipv4"),
            groups=item["groups"],
            matched_by=item.get("matched_by", []),
            matched_groups=item.get("matched_groups", []),
            matched_play_names=item.get("matched_play_names", []),
            filter_reason=item.get("filter_reason"),
        )
        for item in sorted(all_targeted.values(), key=lambda host: (host["hostname"], host["host_id"]))
    ]

    return JobTemplatePreviewRead(
        job_template_id=template.id,
        playbook_id=template.playbook_id,
        playbook_path=playbook.path,
        repo_commit_sha=commit_sha,
        generated_at=datetime.now(timezone.utc),
        template_fingerprint=template_fp,
        inventory_fingerprint=inventory_fingerprint,
        confidence=confidence,  # type: ignore[arg-type]
        target_hosts=target_hosts,
        unmatched_patterns=sorted(set(unmatched_patterns)),
        dynamic_reasons=sorted(set(dynamic_reasons)),
        plays=plays,
    ).model_dump(mode="json")


def get_or_refresh_job_template_preview(db: Session, template_id: int, force: bool = False) -> JobTemplatePreviewRead:
    template = db.get(JobTemplate, template_id)
    if template is None:
        raise ValueError("Job template not found")
    if template.playbook_id is None:
        raise ValueError("Template has no playbook configured")
    playbook = db.get(AnsiblePlaybook, template.playbook_id)
    if playbook is None:
        raise ValueError("Template playbook not found")

    preview_payload = generate_job_template_preview(db, template)
    cache = (
        db.query(JobTemplatePreviewCache).filter(JobTemplatePreviewCache.job_template_id == template_id).one_or_none()
    )
    if cache is None:
        cache = JobTemplatePreviewCache(job_template_id=template_id)
        db.add(cache)

    stale = force or (
        cache.playbook_id != template.playbook_id
        or cache.repo_commit_sha != preview_payload["repo_commit_sha"]
        or cache.template_fingerprint != preview_payload["template_fingerprint"]
        or cache.inventory_fingerprint != preview_payload["inventory_fingerprint"]
    )
    if stale or cache.preview_json is None:
        cache.playbook_id = template.playbook_id
        cache.repo_commit_sha = preview_payload["repo_commit_sha"]
        cache.template_fingerprint = preview_payload["template_fingerprint"]
        cache.inventory_fingerprint = preview_payload["inventory_fingerprint"]
        cache.preview_json = preview_payload
        cache.generated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(cache)
    elif cache.preview_json:
        preview_payload = cache.preview_json

    return JobTemplatePreviewRead.model_validate(cache.preview_json)
