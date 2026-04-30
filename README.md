<p align="center">
  <img src="frontend/public/logo.svg" alt="SLIM — Simple Lab Inventory Manager" width="480">
</p>

<p align="center">
  A self-hosted inventory management app for homelabs and small infrastructure teams.
</p>

---

## Features

- **Full CRUD API** for hosts, VLANs, roles, apps, datastores, domains, K3s clusters, and more
- **Role matrix** — spreadsheet-style grid for bulk host/role assignment across the entire inventory
- **Role-based access control** — admin (read/write) and readonly (read-only) roles
- **Proxmox integration** — auto-sync VMs and containers from Proxmox VE clusters
- **Automation workspace** — Git repos, job templates, automation runs, and vault credentials in one section
- **Monitoring workspace** — Prometheus/Loki overview, alerts, capacity, host health, service activity, and log visibility for homelab services
- **Agentic AI Ops** — admin-only manager + specialist agents with editable prompts, provider/model selection, job-template-backed AI tools, markdown chat, and auto-titled conversations
- **Ansible dynamic inventory** — `GET /api/inventory/ansible` returns a ready-to-use JSON inventory
- **Job templates and run history** — reusable Ansible execution configs with run tracking
- **Custom fields** — define per-app, per-role, and per-status variables exported as Ansible hostvars
- **Database backups** — encrypted backup/restore through the UI with scheduling and retention
- **Field-level encryption** — secrets are stored encrypted at rest with Fernet
- **Dark/light theme** — Ant Design v5 token-based theming with OS preference detection; dark mode backgrounds follow the active palette tint (violet, cyan, amber, green, or neutral)
- **Docker Compose deployment** — single command to run the full stack

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | React 18, TypeScript, Vite, Ant Design |
| Backend | FastAPI, SQLAlchemy 2, Pydantic v2, Alembic |
| Database | MySQL 8 |
| Automation Sidecar | FastAPI + `ansible-playbook` runner |
| Auth | Argon2 password hashing, JWT tokens, httpOnly cookies |
| Runtime | Docker Compose (nginx + uvicorn + mysql + ansible-runner) |

## Quick Start

### Option A — Pre-built images (recommended)

```bash
git clone https://github.com/jdam11/slimventory slim
cd slim
cp .env.example .env
```

Edit `.env` and set **at minimum**:

```env
# Generate with: python -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=<your-random-64-hex-chars>

DB_PASSWORD=<strong-database-password>
MYSQL_ROOT_PASSWORD=<strong-root-password>

ADMIN_PASSWORD=<strong-admin-password>
READONLY_PASSWORD=<strong-readonly-password>
```

Then pull and start:

```bash
docker compose -f docker-compose.release.yml pull
docker compose -f docker-compose.release.yml up -d
```

### Option B — Build from source

```bash
git clone https://github.com/jdam11/slimventory slim
cd slim
cp .env.example .env
# edit .env as above
docker compose up --build -d
```

### Access

| Service | URL |
|---------|-----|
| Web UI | http://localhost:3000 |
| API health | http://localhost:3000/api/health |
| API docs (debug mode only) | http://localhost:3000/api/docs |

> API docs are only available when `LOG_LEVEL=DEBUG`. This is disabled by default for security.

## UI Overview

The web UI is organized into nested navigation groups:

- **Overview** — dashboard, admin-only AI Ops, and monitoring views
- **Inventory** — inventory overview, hosts, resources, storage, Proxmox, lookup tables, Ansible defaults, inventory explorer, and role matrix
- **Automation** — Git repos, job templates, automation runs, and vault credentials
- **Admin** — users and backups

The landing page at `/` is the operational dashboard. The older inventory-heavy dashboard experience is preserved at **Inventory Overview**. The AI Ops workspace is available to admins at `/assistant` and from the global floating assistant panel.

## Default Users

Users are seeded on first startup from `.env` values:

| Role | Username | Password env var |
|------|----------|------------------|
| Admin | `ADMIN_USERNAME` (default: `admin`) | `ADMIN_PASSWORD` |
| Readonly | `READONLY_USERNAME` (default: `viewer`) | `READONLY_PASSWORD` |

**Change the default passwords before exposing the app outside your local network.**

## Configuration

All settings are configured through environment variables in `.env`. See [`.env.example`](.env.example) for the full list with documentation.

Key settings:

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | JWT signing key (min 32 chars, required) | — |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT token lifetime | `60` |
| `SECURE_COOKIES` | Set `true` behind HTTPS proxy | `false` |
| `CORS_ORIGINS` | Allowed origins (comma-separated) | `http://localhost:3000,http://localhost:5173` |
| `TRUSTED_PROXIES` | CIDRs that may set X-Real-IP | `127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` |
| `ANSIBLE_INVENTORY_TOKEN` | Static token for script access to inventory | unset (disabled) |
| `PROXMOX_ENCRYPTION_KEY` | Fernet key for stored Proxmox credentials | derived from `SECRET_KEY` |
| `MONITORING_PROMETHEUS_URL` | Base URL for Prometheus queries | unset |
| `MONITORING_LOKI_URL` | Base URL for Loki queries | unset |
| `MONITORING_TIMEOUT_SECONDS` | Timeout for Prometheus and Loki API calls | `10` |
| `BACKUP_DIR` | Path inside container for encrypted backups | `/backups` |
| `LOG_LEVEL` | Logging level (also controls API docs visibility) | `INFO` |

AI providers, agent prompts, per-agent model selection, AI tools, and the global `Agentic NOC / IT` feature toggle are not configured through `.env`. Admins manage them in the UI, and provider API keys are stored encrypted at rest.

## Repository Structure

```
.
├── backend/                 # FastAPI application
│   ├── app/
│   │   ├── models/          # SQLAlchemy ORM models, including automation and AI Ops models
│   │   ├── routers/         # API route handlers for inventory, automation, monitoring, AI Ops, auth, and backups
│   │   ├── schemas/         # Pydantic request/response schemas
│   │   ├── services/        # Business logic (Proxmox sync, backups, monitoring, AI orchestration, automation execution)
│   │   ├── config.py        # Environment-based settings
│   │   ├── deps.py          # Auth dependencies
│   │   ├── main.py          # FastAPI app, middleware, startup
│   │   └── security.py      # JWT, password hashing, Fernet encryption
│   ├── alembic/             # Database migrations
│   ├── tests/               # pytest test suite
│   ├── Dockerfile
│   └── pyproject.toml
├── frontend/                # React SPA
│   ├── src/
│   │   ├── api/             # Axios API client modules, including automation APIs
│   │   ├── components/      # Reusable UI components and selectors
│   │   ├── pages/           # Dashboard, automation pages, and table views
│   │   ├── store/           # Auth and theme contexts
│   │   └── types/           # TypeScript interfaces
│   ├── nginx.conf           # Nginx config with security headers
│   └── Dockerfile
├── db/
│   ├── schema.sql           # Database schema and views
│   └── 02_grants.sh         # User grants
├── docker-compose.yml
├── Makefile
└── .env.example
```

## Make Commands

```bash
make dev          # docker compose up --build (foreground)
make build        # docker compose build
make down         # docker compose down
make pull         # pull pre-built release images (docker-compose.release.yml)
make test         # run backend tests in Docker (SQLite, no MySQL needed)
make seed         # run seed script locally with uv
make lint         # run ruff linter on backend
make hooks-install  # install local pre-commit and pre-push hooks
make secrets-scan   # scan the full git history for secrets with gitleaks
make verify         # run lint, tests, frontend build, and secret scan
```

## Local Git Safety Checks

This repo includes local git hooks through [`pre-commit`](https://pre-commit.com/):

```bash
make hooks-install
```

Installed hooks do two things:

- `pre-commit` blocks obvious sensitive files such as `.env`, private keys, `backups/`, and `secrets/`, then scans staged content for secrets.
- `pre-push` runs `make lint`, `make test`, and `npm --prefix frontend run build`.

For a one-time release sweep across the full repository history, run:

```bash
make secrets-scan
```

## API Access Model

- Authenticated users can read the inventory API, monitoring summaries, Git repos, discovered playbooks, job templates, and playbook run history.
- `vault-credentials`, database backups, and all mutating routes are **admin-only**.
- Agentic AI Ops routes are **admin-only**. Readonly users do not have access to AI conversations, providers, agents, tools, or chat.
- Admins manage AI providers, provider models, the agent roster, system prompts, AI tools, and the global AI feature flag.
- AI-triggered execution is bounded to enabled AI tools that wrap existing job templates and are assigned to the selected specialist agent.
- Readonly users receive `403 Forbidden` on mutating endpoints and AI routes.
- Login is rate-limited to 5 requests/minute per IP.

## Automation

SLIM includes a dedicated automation area in the UI and API.

### UI sections

- **Git Repos** — register Ansible repos and app repos
- **Job Templates** — save reusable playbook execution definitions
- **Automation Runs** — view ad-hoc and template-triggered run history
- **Vault Credentials** — store encrypted Ansible Vault passwords

### Current capabilities

- discover playbooks from synced Git repositories
- launch ad-hoc playbook runs and template-backed runs
- review automation run history and streamed output
- save reusable job templates with cron schedules, runbook metadata, and alert matching rules
- bulk-import app definitions from nested app repositories
- manage encrypted vault credentials for template-backed playbook execution
- surface monitoring alerts with suggested runbooks and AI-enabled remediation hints
- expose selected job templates as bounded AI tools with admin-defined names and usage guidance

## Agentic AI Ops

SLIM includes an admin-only AI Ops workspace for homelab NOC and IT workflows.

It is designed with a zero-trust model:

- all AI routes require admin access and the global `Agentic NOC / IT` feature switch
- the Manager agent either answers directly or delegates to exactly one specialist
- built-in specialists cover monitoring, incident response, and automation, and admins can add custom specialists
- each agent can use its own provider, model, and system prompt
- prompt-assist and tool-prefill use a sanitized SLIM lab profile rather than raw secret-bearing records
- specialists can only run enabled AI tools assigned to them
- AI tools wrap existing job templates only; AI cannot launch arbitrary playbooks or perform unrestricted writes
- secrets, tokens, vault values, API keys, SSH keys, and masked fields are excluded from prompt context

Chat responses stream over SSE, render markdown in the UI, and conversations are automatically titled after the first response. Conversations are stored per admin user and are not shared.

## Ansible Dynamic Inventory

The app exposes a standard [Ansible dynamic inventory](https://docs.ansible.com/ansible/latest/inventory_guide/intro_dynamic_inventory.html) endpoint:

```
GET /api/inventory/ansible
```

### Authentication

**Session/bearer auth** — any valid JWT via `Authorization: Bearer <token>` header or `access_token` cookie.

**Managed or static inventory token** — create a managed inventory API key in the admin UI, or set `ANSIBLE_INVENTORY_TOKEN` in `.env`, then send it with `X-Inventory-Token`:

```bash
curl -H "X-Inventory-Token: <token>" https://your-host/api/inventory/ansible
```

### Usage with Ansible

Ansible's built-in URL inventory source does not send custom headers. Use a small wrapper script or CI step that fetches the inventory with `X-Inventory-Token` and passes the resulting JSON to Ansible.

```bash
curl -fsS -H "X-Inventory-Token: <token>" https://your-host/api/inventory/ansible > inventory.json
ansible-inventory -i inventory.json --list
ansible -i inventory.json all -m ping
```

### Host variables and groups

Each host receives variables from the inventory view plus any custom field values (app fields, role fields, status fields, ansible defaults). Groups are auto-generated from environment, role, host type, VLAN, K3s cluster, apps, status, and datastores.

Variable precedence (lowest to highest): base hostvars, ansible defaults, status field defaults, role field defaults, app field defaults, per-host status overrides, per-host role overrides, per-host app overrides, per-host ansible var overrides.

## Proxmox Integration

Sync VMs and containers from Proxmox VE into the inventory.

1. Add Proxmox credentials via the **Proxmox** page or `POST /api/proxmox/credentials`
2. Trigger a sync manually or configure an automatic cron schedule
3. New VMs are auto-created or queued as **pending hosts** for review

### What gets synced

- **Hosts** — VMIDs become `hosts.id`; names, IPs, and MACs are updated
- **Resources** — CPU cores, RAM from Proxmox cluster data
- **Storage** — disk entries upserted per purpose; stale disks removed
- **VM tags** — `app:<name>` maps to apps, `status:<name>` maps to host statuses
- **Datastores** — referenced names are auto-created if not present

### Pending hosts

When required lookup tables are empty, new VMs are queued for manual review. Fill in required fields, then promote or dismiss. Pending entries are automatically cleaned up when hosts are created during a subsequent sync.

### Credential import

Import credentials in bulk from a YAML or JSON file via the Proxmox page. YAML files support both array format and multi-document (`---` separated) format. Imported credentials are created as **inactive** — add authentication details and activate them when ready.

### Credential storage

Token secrets and passwords are encrypted at rest with Fernet symmetric encryption. Generate a dedicated key for production:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

## Database Backups

SLIM includes built-in database backup and restore through the web UI.

### Features

- **Encrypted at rest** — backups are encrypted with Fernet (HKDF-derived key) during creation; plaintext never touches disk
- **Scheduled backups** — configure a cron schedule for automatic backups
- **Retention policy** — set how many backups to keep; oldest are pruned automatically
- **Download** — download encrypted backup files from the UI
- **Restore** — restore from any completed backup with confirmation safeguard
- **Audit logged** — all backup operations are logged to the security audit log

### Configuration

Backups are stored on the host filesystem at `./backups` (bind-mounted into the backend container). Configure via the **Backups** page in the UI or the API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/backups/config` | `GET` | Get schedule and retention settings |
| `/api/backups/config` | `PATCH` | Update schedule and retention |
| `/api/backups/trigger` | `POST` | Trigger a manual backup |
| `/api/backups/history` | `GET` | List backup history |
| `/api/backups/{id}/download` | `GET` | Download encrypted backup |
| `/api/backups/restore` | `POST` | Restore from backup |
| `/api/backups/{id}` | `DELETE` | Delete a backup |

All backup endpoints require admin access.

### Important notes

- Backups are encrypted with a key derived from `SECRET_KEY`. A backup can only be restored to an instance with the same `SECRET_KEY`.
- Restore is a destructive operation — the current database is overwritten.
- Only one backup or restore can run at a time (protected by a lock).

## Security

### AI and deployment disclaimer

AI tools were used to help build the frontend and assist with development and debugging. All code was reviewed by the project maintainer before release.

Although safety precautions have been taken, SLIM is intended for internal infrastructure use. Do not expose it directly to the public internet or publish the app containers directly on your LAN. For HTTPS/SSL access, run SLIM behind a reverse proxy on the same Docker host and expose only the proxy.

### Repository change control

Changes to the public GitHub repository require two separate GitHub users with two-factor authentication enabled. One authenticated user publishes the proposed change to a release branch, and a different authenticated user must review and approve the pull request before it can merge. Protected branch rules prevent direct pushes and force pushes to `main`, reducing the risk that one stolen token or compromised account can edit the protected public repository alone.

### Headers

All API responses include:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `Cache-Control` | `no-store` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (when `SECURE_COOKIES=true`) |
| `Content-Security-Policy` | Strict policy via nginx (see `frontend/nginx.conf`) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation()` |

### Authentication and input validation

- Passwords hashed with **Argon2** (with transparent upgrade from legacy PBKDF2)
- Password policy enforces minimum 8 characters with uppercase, lowercase, and digit
- JWT tokens with configurable expiry
- httpOnly, SameSite=lax cookies
- Rate limiting on login endpoints (5/minute per IP)
- Trusted proxy validation — `X-Real-IP` only honored from `TRUSTED_PROXIES` CIDRs
- All inputs validated through Pydantic schemas
- Query parameters bounded (`limit` max 1000, `skip` min 0)
- SSRF protection on Proxmox URLs (blocks loopback and link-local addresses)
- Constant-time token comparison for inventory tokens

### Data at rest

| Data | Protection |
|------|------------|
| User passwords | Argon2 (irreversible) |
| Proxmox credentials | Fernet symmetric encryption |
| Vault credentials | Fernet-wrapped secret fields |
| AI provider API keys | Fernet symmetric encryption |
| App/role/status field secrets | Fernet symmetric encryption (auto-detected) |
| Database backups | Fernet symmetric encryption (HKDF-derived key) |
| Other inventory data | Plaintext |

### Production checklist

- [ ] Set strong, unique values for `SECRET_KEY`, `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`
- [ ] Change default `ADMIN_PASSWORD` and `READONLY_PASSWORD`
- [ ] Set `SECURE_COOKIES=true` behind an HTTPS reverse proxy
- [ ] Set a dedicated `PROXMOX_ENCRYPTION_KEY`
- [ ] Review `CORS_ORIGINS` — remove localhost entries
- [ ] Review `TRUSTED_PROXIES` — restrict to your actual proxy IPs
- [ ] Generate an `ANSIBLE_INVENTORY_TOKEN` if using script-mode access
- [ ] Review enabled AI providers, agents, system prompts, and AI tools before enabling `Agentic NOC / IT`

## Testing

```bash
make test
```

Runs pytest inside a Docker container against an in-memory SQLite database — no running MySQL required.

Test coverage includes: authentication flows, role enforcement, CRUD operations, automation workflows, Proxmox credential handling (including inactive credential creation and activation validation), monitoring/AI API coverage, sync scheduling, pending host queue, and field encryption.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
