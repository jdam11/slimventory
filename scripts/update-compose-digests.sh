#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 VERSION BACKEND_DIGEST FRONTEND_DIGEST ANSIBLE_DIGEST" >&2
  echo "  digests must include the sha256: prefix" >&2
  exit 2
fi

VERSION="$1"
BACKEND_DIGEST="$2"
FRONTEND_DIGEST="$3"
ANSIBLE_DIGEST="$4"

for d in "$BACKEND_DIGEST" "$FRONTEND_DIGEST" "$ANSIBLE_DIGEST"; do
  if [[ ! "$d" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "ERROR: invalid digest '$d' (expected sha256:<64 hex chars>)" >&2
    exit 2
  fi
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILES=(
  "$ROOT/docker-compose.release.yml"
  "$ROOT/docker-compose.traefik.yml"
  "$ROOT/docker-compose.public.yml"
)

declare -A IMAGES=(
  [backend]="$BACKEND_DIGEST"
  [frontend]="$FRONTEND_DIGEST"
  [ansible-runner]="$ANSIBLE_DIGEST"
)

for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing file $f" >&2
    exit 1
  fi
  for svc in "${!IMAGES[@]}"; do
    digest="${IMAGES[$svc]}"
    sed -i -E "s|image: jdam11/slim-${svc}:[^@[:space:]]+@sha256:[0-9a-f]{64}|image: jdam11/slim-${svc}:${VERSION}@${digest}|g" "$f"
  done
done

if command -v docker >/dev/null 2>&1; then
  for f in "${FILES[@]}"; do
    docker compose -f "$f" config -q
  done
fi

echo "Updated ${#FILES[@]} compose files to v${VERSION}."
