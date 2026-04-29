#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
hooks_dir=$(git config --get core.hooksPath 2>/dev/null || true)

if [ -z "${hooks_dir}" ]; then
  hooks_dir="${repo_root}/.git/hooks"
fi

mkdir -p "${hooks_dir}"

cat > "${hooks_dir}/pre-commit" <<EOF
#!/bin/sh
set -eu
cd "${repo_root}"
exec pre-commit run --config .pre-commit-config.yaml --hook-stage pre-commit
EOF

cat > "${hooks_dir}/pre-push" <<EOF
#!/bin/sh
set -eu
cd "${repo_root}"
exec pre-commit run --config .pre-commit-config.yaml --hook-stage pre-push
EOF

chmod +x "${hooks_dir}/pre-commit" "${hooks_dir}/pre-push"

printf 'Installed git hooks in %s\n' "${hooks_dir}"
