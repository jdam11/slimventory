#!/bin/sh
set -eu

CODEQL_VERSION="2.25.2"
CODEQL_URL="https://github.com/github/codeql-action/releases/download/codeql-bundle-v${CODEQL_VERSION}/codeql-bundle-linux64.tar.gz"
CODEQL_SHA256="7e05c89e172f500be8c718d32a355e481bd1b24a85551a2b4c30a7ab00949399"

REPO_ROOT=$(git rev-parse --show-toplevel)

resolve_codeql() {
    if command -v codeql >/dev/null 2>&1; then
        echo "codeql"
        return
    fi

    if ! command -v curl >/dev/null 2>&1; then
        echo "codeql is not installed and curl is not available to download it." >&2
        echo "Install the CodeQL CLI from https://github.com/github/codeql-action/releases" >&2
        exit 1
    fi

    install_dir="${HOME}/.local/codeql-${CODEQL_VERSION}"
    if [ ! -x "${install_dir}/codeql/codeql" ]; then
        echo "Downloading CodeQL CLI v${CODEQL_VERSION}..." >&2
        tmp=$(mktemp -d)
        trap 'rm -rf "$tmp"' EXIT INT TERM
        curl -fsSLo "${tmp}/codeql.tar.gz" "${CODEQL_URL}"
        printf '%s  %s\n' "${CODEQL_SHA256}" "${tmp}/codeql.tar.gz" | sha256sum -c - >&2
        mkdir -p "${install_dir}"
        tar -xzf "${tmp}/codeql.tar.gz" -C "${install_dir}"
    fi

    echo "${install_dir}/codeql/codeql"
}

CODEQL=$(resolve_codeql)

DB_DIR=$(mktemp -d)
trap 'rm -rf "$DB_DIR"' EXIT INT TERM

echo "CodeQL: creating Python database..."
"$CODEQL" database create "${DB_DIR}/python" \
    --language=python \
    --source-root="${REPO_ROOT}" \
    --overwrite \
    --quiet

echo "CodeQL: analyzing Python..."
"$CODEQL" database analyze "${DB_DIR}/python" \
    codeql/python-queries:codeql-suites/python-security-extended.qls \
    --format=sarif-latest \
    --output="${DB_DIR}/python.sarif" \
    --ram=8192 \
    --quiet

echo "CodeQL: creating JavaScript/TypeScript database..."
"$CODEQL" database create "${DB_DIR}/js" \
    --language=javascript \
    --source-root="${REPO_ROOT}/frontend/src" \
    --overwrite \
    --quiet

echo "CodeQL: analyzing JavaScript/TypeScript..."
"$CODEQL" database analyze "${DB_DIR}/js" \
    codeql/javascript-queries:codeql-suites/javascript-security-extended.qls \
    --format=sarif-latest \
    --output="${DB_DIR}/js.sarif" \
    --ram=8192 \
    --quiet

python3 - "${DB_DIR}/python.sarif" "${DB_DIR}/js.sarif" "${REPO_ROOT}/.codeql/suppressions.json" <<'EOF'
import json, sys

with open(sys.argv[3]) as sf:
    SUPPRESSED = {(e["rule"], e["file"], e["line"]) for e in json.load(sf)}

def is_suppressed(rule, uri, line):
    return any(rule == r and uri.endswith(f) and line == ln for r, f, ln in SUPPRESSED)

total = 0
labels = {"python.sarif": "Python", "js.sarif": "JS/TS"}
for path in sys.argv[1:3]:
    label = labels.get(path.rsplit("/", 1)[-1], path)
    with open(path) as f:
        data = json.load(f)
    all_results = [r for run in data.get("runs", []) for r in run.get("results", [])]
    results = []
    for r in all_results:
        rule = r.get("ruleId", "unknown")
        locs = r.get("locations", [{}])
        loc = locs[0].get("physicalLocation", {}) if locs else {}
        uri = loc.get("artifactLocation", {}).get("uri", "")
        line = loc.get("region", {}).get("startLine")
        if not is_suppressed(rule, uri, line):
            results.append(r)
    if results:
        print(f"\n{label}: {len(results)} finding(s)")
        for r in results:
            rule = r.get("ruleId", "unknown")
            msg = r.get("message", {}).get("text", "")
            locs = r.get("locations", [{}])
            loc = locs[0].get("physicalLocation", {}) if locs else {}
            uri = loc.get("artifactLocation", {}).get("uri", "")
            line = loc.get("region", {}).get("startLine", "?")
            print(f"  {rule}: {uri}:{line} — {msg}")
    total += len(results)

if total:
    print(f"\n{total} total finding(s). Fix or suppress before pushing.")
    sys.exit(1)
else:
    print("CodeQL: no findings.")
EOF
