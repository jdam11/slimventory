from app.models.ai import AiProvider, AiProviderType
from app.models.git import AnsiblePlaybook, GitAuthType, GitRepo, GitRepoType
from app.models.job_templates import InventoryFilterType, JobTemplate


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_provider(db) -> AiProvider:
    provider = AiProvider(
        name="test-ai",
        provider_type=AiProviderType.ollama,
        base_url="http://ollama.local",
        default_model="llama3",
        is_enabled=True,
        is_default=True,
        request_timeout_seconds=30,
    )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider


def _create_job_template(db) -> JobTemplate:
    repo = GitRepo(
        name="ansible-lab",
        url="https://example.invalid/ansible-lab.git",
        branch="main",
        repo_type=GitRepoType.ansible,
        auth_type=GitAuthType.none,
    )
    db.add(repo)
    db.commit()
    db.refresh(repo)

    playbook = AnsiblePlaybook(repo_id=repo.id, path="playbooks/restart-exporter.yml")
    db.add(playbook)
    db.commit()
    db.refresh(playbook)

    template = JobTemplate(
        name="Restart Exporter",
        playbook_id=playbook.id,
        inventory_filter_type=InventoryFilterType.all,
        runbook_enabled=True,
        runbook_category="restart",
        recommended_when="Use when exporter telemetry is stale.",
        risk_level="low",
        alert_match_type="job_unhealthy",
        alert_match_value="node-exporter",
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


def test_admin_can_list_seeded_agents_and_update_settings(client, admin_token):
    agents = client.get("/api/ai/admin/agents", headers=_auth_header(admin_token))
    assert agents.status_code == 200
    items = agents.json()
    assert len(items) == 4
    assert {item["agent_type"] for item in items} == {
        "manager",
        "noc_monitor",
        "incident_responder",
        "automation_operator",
    }
    assert {item["agent_key"] for item in items} == {
        "manager",
        "noc_monitor",
        "incident_responder",
        "automation_operator",
    }

    settings = client.patch(
        "/api/ai/admin/settings",
        json={"agentic_noc_enabled": True},
        headers=_auth_header(admin_token),
    )
    assert settings.status_code == 200
    assert settings.json()["agentic_noc_enabled"] is True


def test_admin_can_list_provider_models(client, db, admin_token, monkeypatch):
    provider = _create_provider(db)

    import sys

    ai_router = sys.modules["app.routers.ai"]

    async def fake_list_provider_models(candidate):
        assert candidate.id == provider.id
        return ["llama3", "llama3:70b"]

    monkeypatch.setattr(ai_router, "list_provider_models", fake_list_provider_models)

    resp = client.get(f"/api/ai/admin/providers/{provider.id}/models", headers=_auth_header(admin_token))
    assert resp.status_code == 200
    assert resp.json() == {
        "provider_id": provider.id,
        "provider_name": provider.name,
        "default_model": provider.default_model,
        "models": ["llama3", "llama3:70b"],
    }


def test_admin_can_create_update_and_delete_custom_agent(client, db, admin_token):
    provider = _create_provider(db)

    create_resp = client.post(
        "/api/ai/admin/agents",
        json={
            "name": "Storage Analyst",
            "description": "Investigates NAS and storage issues.",
            "provider_id": provider.id,
            "model": "llama3.1",
            "system_prompt": "Focus on homelab storage operations.",
            "is_enabled": True,
        },
        headers=_auth_header(admin_token),
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["agent_type"] == "custom"
    assert created["agent_key"] == "storage-analyst"

    update_resp = client.patch(
        f"/api/ai/admin/agents/{created['id']}",
        json={
            "name": "Storage Triage",
            "description": "Handles storage triage.",
            "system_prompt": "Focus on storage triage and recovery.",
            "is_enabled": False,
        },
        headers=_auth_header(admin_token),
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "Storage Triage"
    assert updated["description"] == "Handles storage triage."
    assert updated["system_prompt"] == "Focus on storage triage and recovery."
    assert updated["is_enabled"] is False
    assert updated["agent_key"] == "storage-analyst"

    delete_resp = client.delete(f"/api/ai/admin/agents/{created['id']}", headers=_auth_header(admin_token))
    assert delete_resp.status_code == 204


def test_prompt_assist_includes_lab_context(client, db, admin_token, monkeypatch):
    _create_provider(db)
    agents = client.get("/api/ai/admin/agents", headers=_auth_header(admin_token))
    manager = next(item for item in agents.json() if item["agent_type"] == "manager")

    import sys

    ai_router = sys.modules["app.routers.ai"]

    async def fake_stream_provider_response(*_args, **kwargs):
        prompt_messages = kwargs["prompt_messages"]
        prompt_input = prompt_messages[1]["content"]
        assert "Lab context summary:" in prompt_input
        assert "Lab profile JSON:" in prompt_input
        assert '"inventory_summary"' in prompt_input
        yield "Refined manager prompt."

    monkeypatch.setattr(ai_router, "stream_provider_response", fake_stream_provider_response)

    resp = client.post(
        "/api/ai/admin/prompt-assist/stream",
        json={"agent_id": manager["id"], "message": "Improve the manager prompt for my lab."},
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 200
    assert "Refined manager prompt." in resp.text


def test_chat_auto_names_conversation(client, db, admin_token, monkeypatch):
    _create_provider(db)
    client.patch(
        "/api/ai/admin/settings",
        json={"agentic_noc_enabled": True},
        headers=_auth_header(admin_token),
    )

    import sys

    ai_router = sys.modules["app.routers.ai"]

    async def fake_collect_provider_response(*_args, **_kwargs):
        return '{"mode":"delegate","agent_key":"noc_monitor","reason":"monitoring question"}'

    async def fake_stream_provider_response(*_args, **_kwargs):
        yield "Node exporter is healthy."

    async def fake_generate_conversation_title(*_args, **_kwargs):
        return "Node Exporter Health"

    monkeypatch.setattr(ai_router, "collect_provider_response", fake_collect_provider_response)
    monkeypatch.setattr(ai_router, "stream_provider_response", fake_stream_provider_response)
    monkeypatch.setattr(ai_router, "generate_conversation_title", fake_generate_conversation_title)

    resp = client.post(
        "/api/ai/chat/stream",
        json={"message": "check node exporter health", "page_context": {"route": "/monitoring"}},
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 200

    conversations = client.get("/api/ai/conversations", headers=_auth_header(admin_token))
    items = conversations.json()["items"]
    assert items[0]["title"] == "Node Exporter Health"


def test_readonly_user_cannot_access_ai_endpoints(client, readonly_token):
    settings = client.get("/api/ai/admin/settings", headers=_auth_header(readonly_token))
    assert settings.status_code == 403

    chat = client.post(
        "/api/ai/chat/stream",
        json={"message": "check monitoring"},
        headers=_auth_header(readonly_token),
    )
    assert chat.status_code == 403


def test_admin_can_create_ai_tool_for_job_template(client, db, admin_token):
    _create_provider(db)
    template = _create_job_template(db)
    agents = client.get("/api/ai/admin/agents", headers=_auth_header(admin_token))
    automation_agent = next(item for item in agents.json() if item["agent_type"] == "automation_operator")

    resp = client.post(
        "/api/ai/admin/tools",
        json={
            "job_template_id": template.id,
            "is_enabled": True,
            "tool_name": "restart-exporter",
            "description": "Restart the exporter service.",
            "when_to_use": "Use when telemetry is stale.",
            "input_hint": "Review the target scope before running.",
            "example_payload": {"reason": "stale metrics"},
            "safety_notes": "Low-risk restart only.",
            "agent_ids": [automation_agent["id"]],
        },
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["tool_name"] == "restart-exporter"
    assert body["job_template_id"] == template.id
    assert [agent["agent_type"] for agent in body["assigned_agents"]] == ["automation_operator"]


def test_chat_is_blocked_when_feature_disabled(client, db, admin_token):
    _create_provider(db)
    resp = client.post(
        "/api/ai/chat/stream",
        json={"message": "check monitoring"},
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 409
    assert "disabled" in resp.text.lower()


def test_chat_routes_to_specialist_and_saves_agent_metadata(client, db, admin_token, monkeypatch):
    _create_provider(db)
    client.patch(
        "/api/ai/admin/settings",
        json={"agentic_noc_enabled": True},
        headers=_auth_header(admin_token),
    )

    import sys

    ai_router = sys.modules["app.routers.ai"]

    async def fake_collect_provider_response(*_args, **_kwargs):
        return '{"mode":"delegate","agent_type":"noc_monitor","reason":"monitoring question"}'

    async def fake_stream_provider_response(*_args, **_kwargs):
        yield "CPU is elevated on the selected host."

    monkeypatch.setattr(ai_router, "collect_provider_response", fake_collect_provider_response)
    monkeypatch.setattr(ai_router, "stream_provider_response", fake_stream_provider_response)

    resp = client.post(
        "/api/ai/chat/stream",
        json={"message": "check monitoring status", "page_context": {"route": "/monitoring"}},
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 200
    assert "agent_selected" in resp.text
    assert "NOC Monitor" in resp.text
    assert "CPU is elevated on the selected host." in resp.text

    conversations = client.get("/api/ai/conversations", headers=_auth_header(admin_token))
    conversation_id = conversations.json()["items"][0]["id"]
    detail = client.get(f"/api/ai/conversations/{conversation_id}", headers=_auth_header(admin_token))
    messages = detail.json()["messages"]
    assistant = next(item for item in messages if item["role"] == "assistant")
    assert assistant["agent"]["agent_type"] == "noc_monitor"
