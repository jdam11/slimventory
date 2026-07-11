# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-11

### Added

- **IPAM** — read-only IP Address Management under Networking. Per-VLAN summary with utilization bars, plus per-VLAN detail showing used addresses, duplicate-IP conflicts, out-of-subnet hosts, UniFi observed-vs-inventory drift, and the next free IP. Computed from existing VLAN subnets, host IPs, and UniFi observations — no new tables. New routes `GET /api/ipam` and `GET /api/ipam/{vlan_pk}`.
- **Inventory health report** — read-only data-quality dashboard under Inventory and a summary card on the home dashboard. Flags hosts without roles, stale Proxmox/UniFi syncs, duplicate IPs, apps deployed nowhere, VLANs without hosts, and unused roles. New route `GET /api/inventory-health`.
- **Audit log** — append-only trail of every mutating API request (create/update/delete), captured by middleware and viewable on an admin page plus a "Recent activity" dashboard card. New `audit_log` table and admin-only route `GET /api/audit` with `entity`/`username`/`action`/`since` filters.
- **Outbound notifications** — admin-managed notification channels (ntfy, Gotify, Discord, Slack, generic webhook) that fire on `playbook_run_failed`, `proxmox_pending_host`, `backup_failed`, and `backup_completed` events. New `notification_channels` table, admin CRUD under `/api/notification-channels` with a per-channel test button. Channel secrets are encrypted at rest and never returned by the API.

### Security

- **PyJWT bumped to 2.13.0** — fixes public-key JWK accepted as HMAC secret (forged HS256 tokens), algorithm allow-list bypass with `PyJWK`/`PyJWKClient` keys, unauthenticated DoS via unbounded Base64URL decoding in `b64=false` detached JWS, missing URL-scheme allowlist in `PyJWKClient` (SSRF/token forgery), and unbounded JWKS requests via attacker-controlled `kid` values
- **cryptography bumped to 49.0.0** — ships wheels with patched OpenSSL
- **pydantic-settings bumped to 2.14.2** — fixes symlink-following outside `secrets_dir` enabling local file read
- **form-data bumped to 4.0.6** — fixes CRLF injection via unescaped multipart field names and filenames

### Dependencies

- Frontend major updates: js-yaml 5.x, TypeScript 7.x
- Docker base images and GitHub/Gitea action versions updated

## [0.1.0] - 2026-04-04

Initial public release of SLIM (Simple Lab Inventory Manager).

### Features

- **Host management** — Full CRUD for hosts with environment, VLAN, role, host type, domain, datastore, and K3s cluster assignments
- **Lookup tables** — Environments, VLANs, roles, apps, host types, host statuses, datastores, domains, and K3s clusters
- **Custom fields** — App, role, and status field definitions with per-host overrides and field-level Fernet encryption for secrets
- **Proxmox integration** — Sync VMs and containers from one or more Proxmox VE clusters with scheduled sync, pending host review, bulk promote/dismiss, and tag-based app/status mapping
- **Proxmox credential import** — Bulk import credentials from YAML or JSON files; credentials can be created inactive and activated later
- **Ansible dynamic inventory** — `/api/inventory/ansible` endpoint with token-based script access and full hostvar export including custom fields
- **Database backups** — Encrypted backup and restore through the UI and API with scheduled backups (cron), configurable retention, and download; plaintext never touches disk
- **Dashboard** — Searchable, filterable inventory view with inline host detail editing
- **User management** — Admin and read-only roles with JWT auth, httpOnly cookies, Argon2 password hashing, and rate-limited login
- **Security hardening** — CORS, CSRF protection, security headers (HSTS, CSP, X-Frame-Options), trusted proxy validation, SSRF protection on Proxmox URLs, and constant-time token comparison
- **Dark/light theme** — System-aware theme toggle with persistent preference
- **Responsive UI** — Mobile-friendly layout with Ant Design v5
- **CSV export** — Export full inventory as CSV
- **Runtime log level** — Change log level via API without restart

### Infrastructure

- Three-service Docker Compose stack (MySQL 8, FastAPI/uvicorn, React/nginx)
- Alembic migrations for user and backup tables
- APScheduler for background Proxmox sync and backup scheduling
- Fernet encryption with HKDF key derivation for backup isolation
- Comprehensive test suite running on in-memory SQLite

## [1.0.2] - 2026-06-13

### Security

- **axios bumped to 1.17.0** — fixes proxy MitM/prototype pollution, NO_PROXY bypass, Proxy-Authorization leak on redirect, ReDoS, and resource-exhaustion advisories
- **starlette bumped to 1.3.1** — fixes Host header validation / `url.path` poisoning
- **react-router(-dom) bumped to 7.17.0** — fixes `__manifest` denial of service
- **python-multipart bumped to 0.0.32** — fixes unbounded part-header denial of service
- **idna bumped to 3.18** — fixes `idna.encode` bypass of the CVE-2024-3651 fix

## [1.0.1] - 2026-05-08

### Changed

- **MySQL upgraded from 8.4 LTS to 9.7 LTS** — default database image updated across all compose files
- **Production compose files are now fully self-contained** — every image is pinned by SHA256 digest; no external overlay files required

### Fixed

- **CVE-2026-42561** — python-multipart bumped to 0.0.27

### Dependencies

- Frontend dependencies updated
- Python base image updated to 3.14.4
- Traefik updated to 3.7.0
- Docker base images updated

## [1.0.0] - 2026-04-29

### Added

- **Automation workspace** — Git repo sync, playbook discovery, job templates, schedules, vault credentials, and ansible-runner-backed execution flows
- **Monitoring workspace** — Prometheus/Loki overview, alert center, capacity, host health, service activity, and log explorer views with suggested runbooks
- **Agentic AI Ops** — admin-only manager-and-specialist agents, provider/model management, prompt assist, job-template-backed AI tools, markdown chat rendering, and automatic chat titles
- **OpenWebUI and Anthropic provider support** in the AI Ops provider list
- **Role matrix** — `Inventory > Role Matrix` spreadsheet grid for bulk host/role assignment; click any cell to toggle; host and role search filters; read-only for non-admins (`GET /api/role-matrix/`, `POST /api/role-matrix/toggle`)
- **Inventory explorer** — per-host variable browser with lineage trace, precedence visualization, and host-level override editor (`Inventory > Inventory Explorer`)
- **Docker Hub release** — pre-built images published at `slimventory/slim-backend`, `slimventory/slim-frontend`, and `slimventory/slim-ansible-runner`

### Changed

- **AI execution model** now uses admin-managed AI tools backed by job templates instead of per-user template approvals
- **Overview navigation** now includes the AI Ops workspace alongside dashboard and monitoring views
- **Dark mode backgrounds** now derive their tint from the active palette instead of a shared violet base — Arctic shows cyan, Ember shows amber, Plasma shows green, Graphite stays neutral
- **Inventory explorer dark mode** readability improved: var rows, signal blocks, lineage rows, and table headers use elevated surface tokens for contrast
- **Documentation and wiki** refreshed for the current navigation, API surface, monitoring workflows, automation workflows, and AI Ops architecture
