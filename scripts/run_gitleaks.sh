#!/bin/sh
set -eu

GITLEAKS_VERSION="8.30.1"
GITLEAKS_TARBALL="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
GITLEAKS_URL="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${GITLEAKS_TARBALL}"
GITLEAKS_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"

if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks "$@"
fi

if command -v curl >/dev/null 2>&1; then
  temp_dir=$(mktemp -d)
  trap 'rm -rf "$temp_dir"' EXIT INT TERM
  curl -fsSLo "${temp_dir}/${GITLEAKS_TARBALL}" "${GITLEAKS_URL}"
  printf '%s  %s\n' "${GITLEAKS_SHA256}" "${temp_dir}/${GITLEAKS_TARBALL}" | sha256sum -c -
  tar -xzf "${temp_dir}/${GITLEAKS_TARBALL}" -C "${temp_dir}" gitleaks
  exec "${temp_dir}/gitleaks" "$@"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "gitleaks, curl, or docker is required to scan for secrets." >&2
  exit 1
fi

repo_root=$(git rev-parse --show-toplevel)
workdir=$(pwd)

docker run --rm \
  -v "${repo_root}:/repo" \
  -w "/repo${workdir#${repo_root}}" \
  ghcr.io/gitleaks/gitleaks:v8.30.0@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9 "$@"
