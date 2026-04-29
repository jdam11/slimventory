// Shared TypeScript types matching the backend Pydantic schemas

export type UserRole = "admin" | "readonly";

export interface User {
  id: number;
  username: string;
  email: string | null;
  role: UserRole;
  is_active: boolean;
}

export interface PageResponse<T> {
  items: T[];
  total: number;
}

export interface LogLevelResponse {
  log_level: string;
}

export type InventoryApiKeyPermission = "ansible_inventory_read";

export interface InventoryApiKey {
  id: number;
  name: string;
  description: string | null;
  key_prefix: string;
  permissions: InventoryApiKeyPermission[];
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: number | null;
}

export interface InventoryApiKeyCreate {
  name: string;
  description?: string | null;
  permissions: InventoryApiKeyPermission[];
  is_active?: boolean;
}

export interface InventoryApiKeyUpdate {
  name?: string;
  description?: string | null;
  permissions?: InventoryApiKeyPermission[];
  is_active?: boolean;
}

export interface InventoryApiKeySecret {
  api_key: string;
  key: InventoryApiKey;
}

export interface AnsibleRunnerSettings {
  kerberos_enabled: boolean;
  kerberos_krb5_conf: string | null;
  kerberos_ccache_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnsibleRunnerSettingsUpdate {
  kerberos_enabled?: boolean;
  kerberos_krb5_conf?: string | null;
  kerberos_ccache_name?: string | null;
}

export interface SshKnownHostCache {
  path: string;
  exists: boolean;
  size_bytes: number;
  line_count: number;
  modified_at: string | null;
}

export interface SshKnownHostsSummary {
  ansible: SshKnownHostCache;
  git: SshKnownHostCache;
}

export interface ClearedKnownHostsResult {
  target: string;
  aliases: string[];
  cache: SshKnownHostCache;
}

export interface MonitoringBackendStatus {
  configured: boolean;
  reachable: boolean;
  ready: boolean | null;
  url: string | null;
  version: string | null;
  error: string | null;
}

export type MonitoringAuthType = "none" | "basic" | "bearer";
export type SecretInjectionMode = "extra_vars" | "vault_password_file";

export interface MonitoringBackendSettings {
  enabled: boolean;
  url: string | null;
  timeout_seconds: number;
  verify_tls: boolean;
  auth_type: MonitoringAuthType;
  username: string | null;
  has_password: boolean;
  has_bearer_token: boolean;
}

export interface MonitoringBitwardenSettings {
  enabled: boolean;
  server_url: string | null;
  has_access_token: boolean;
  verify_tls: boolean;
  organization_id: string | null;
  collection_id: string | null;
  auth_method: string;
}

export interface MonitoringSettings {
  prometheus: MonitoringBackendSettings;
  loki: MonitoringBackendSettings;
  bitwarden: MonitoringBitwardenSettings;
  created_at: string | null;
  updated_at: string | null;
}

export interface MonitoringBackendSettingsUpdate {
  enabled?: boolean;
  url?: string | null;
  timeout_seconds?: number;
  verify_tls?: boolean;
  auth_type?: MonitoringAuthType;
  username?: string | null;
  password?: string | null;
  bearer_token?: string | null;
}

export interface MonitoringBitwardenSettingsUpdate {
  enabled?: boolean;
  server_url?: string | null;
  access_token?: string | null;
  verify_tls?: boolean;
  organization_id?: string | null;
  collection_id?: string | null;
  auth_method?: string;
}

export interface MonitoringSettingsUpdate {
  prometheus?: MonitoringBackendSettingsUpdate;
  loki?: MonitoringBackendSettingsUpdate;
  bitwarden?: MonitoringBitwardenSettingsUpdate;
}

export interface MonitoringSecretMapping {
  id: number;
  name: string;
  job_template_id: number | null;
  item_reference: string;
  item_field: string;
  ansible_var_name: string;
  injection_mode: SecretInjectionMode;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MonitoringSecretMappingCreate {
  name: string;
  job_template_id?: number | null;
  item_reference: string;
  item_field?: string;
  ansible_var_name: string;
  injection_mode?: SecretInjectionMode;
  is_enabled?: boolean;
}

export interface MonitoringSecretMappingUpdate {
  name?: string;
  job_template_id?: number | null;
  item_reference?: string;
  item_field?: string;
  ansible_var_name?: string;
  injection_mode?: SecretInjectionMode;
  is_enabled?: boolean;
}

export interface MonitoringSelectedHost {
  id: number;
  name: string;
  ipv4: string | null;
}

export interface MonitoringJobSummary {
  job: string;
  total_targets: number;
  healthy_targets: number;
  unhealthy_targets: number;
}

export interface MonitoringTargetSummary {
  total_targets: number;
  healthy_targets: number;
  unhealthy_targets: number;
  jobs: MonitoringJobSummary[];
}

export interface MonitoringHostStatus {
  name: string;
  instance: string;
  up: boolean;
  health_score: number;
  cpu_usage_percent: number | null;
  memory_usage_percent: number | null;
  root_disk_usage_percent: number | null;
}

export interface MonitoringLogVolume {
  service_name: string;
  lines_last_hour: number;
  error_lines_last_hour: number;
}

export interface MonitoringLogEntry {
  timestamp: string;
  service_name: string | null;
  job: string | null;
  instance: string | null;
  level: string | null;
  line: string;
}

export interface MonitoringOverview {
  prometheus: MonitoringBackendStatus;
  loki: MonitoringBackendStatus;
  selected_host: MonitoringSelectedHost | null;
  targets: MonitoringTargetSummary;
  hosts: MonitoringHostStatus[];
  log_volume: MonitoringLogVolume[];
  recent_logs: MonitoringLogEntry[];
}

export interface MonitoringSeriesPoint {
  timestamp: string;
  value: number;
}

export interface MonitoringSeries {
  key: string;
  label: string;
  unit: string | null;
  points: MonitoringSeriesPoint[];
}

export interface MonitoringHistory {
  prometheus: MonitoringBackendStatus;
  selected_host: MonitoringSelectedHost | null;
  range_hours: number;
  step_seconds: number;
  generated_at: string;
  series: MonitoringSeries[];
}

export interface MonitoringLogsResponse {
  items: MonitoringLogEntry[];
}

export interface MonitoringSuggestedRunbook {
  job_template_id: number;
  name: string;
  category: string | null;
  risk_level: string | null;
  recommended_when: string | null;
  ai_enabled: boolean;
  ai_agents: string[];
  can_run: boolean;
}

export interface MonitoringAlert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  host_name: string | null;
  service_name: string | null;
  metric_value: number | null;
  threshold: number | null;
  suggested_runbooks: MonitoringSuggestedRunbook[];
}

export interface MonitoringAlertsResponse {
  items: MonitoringAlert[];
}

export type AiProviderType = "ollama" | "openai_compatible" | "openwebui" | "anthropic";
export type AiMessageRole = "system" | "user" | "assistant";
export type AiAgentType = "manager" | "noc_monitor" | "incident_responder" | "automation_operator" | "custom";

export interface AiProvider {
  id: number;
  name: string;
  provider_type: AiProviderType;
  base_url: string;
  default_model: string;
  has_api_key: boolean;
  is_enabled: boolean;
  is_default: boolean;
  request_timeout_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface AiProviderModels {
  provider_id: number | null;
  provider_name: string;
  default_model: string | null;
  models: string[];
}

export interface AiSettings {
  agentic_noc_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiAgentRef {
  id: number;
  agent_key: string;
  agent_type: AiAgentType;
  name: string;
}

export interface AiAgent extends AiAgentRef {
  description: string | null;
  provider_id: number | null;
  provider_name: string | null;
  model: string | null;
  system_prompt: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiToolAgent {
  id: number;
  agent_type: AiAgentType;
  name: string;
}

export interface AiTool {
  id: number;
  job_template_id: number;
  job_template_name: string;
  playbook_id: number | null;
  is_enabled: boolean;
  tool_name: string;
  description: string | null;
  when_to_use: string | null;
  input_hint: string | null;
  example_payload: unknown;
  safety_notes: string | null;
  assigned_agents: AiToolAgent[];
  created_at: string;
  updated_at: string;
}

export interface AiToolCandidate {
  job_template_id: number;
  job_template_name: string;
  playbook_id: number | null;
  runbook_enabled: boolean;
  runbook_category: string | null;
  recommended_when: string | null;
  risk_level: string | null;
  ai_tool_id: number | null;
  ai_enabled: boolean;
}

export interface AiToolPrefill {
  tool_name: string;
  description: string | null;
  when_to_use: string | null;
  input_hint: string | null;
  example_payload: unknown;
  safety_notes: string | null;
  source: string;
}

export interface AiMessage {
  id: number;
  role: AiMessageRole;
  content: string;
  context_summary: string | null;
  agent: AiAgentRef | null;
  created_at: string;
}

export interface AiConversation {
  id: number;
  title: string;
  provider_id: number | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiConversationDetail extends AiConversation {
  messages: AiMessage[];
}

export interface AiPageContext {
  route?: string;
  host_id?: number | null;
  monitoring_host_id?: number | null;
  job_template_id?: number | null;
  playbook_run_id?: number | null;
  editor_title?: string | null;
  editor_language?: string | null;
  editor_content?: string | null;
}

export interface AiChatRequest {
  conversation_id?: number | null;
  message: string;
  page_context?: AiPageContext | null;
}

export interface AiAgentPromptAssistRequest {
  agent_id: number;
  current_prompt?: string | null;
  message: string;
}


export interface Environment {
  id: number;
  name: string;
}

export interface HostType {
  id: number;
  name: string;
}

export interface HostStatus {
  id: number;
  name: string;
}

export interface Vlan {
  id: number;
  vlan_id: number;
  subnet: string | null;
  description: string | null;
}

export interface UnifiPortForward {
  id: number;
  host_id: number;
  rule_name: string | null;
  description: string | null;
  protocol: string | null;
  external_port: string | null;
  internal_port: string | null;
  source_restriction: string | null;
  enabled: boolean;
  observed_at: string;
}

export interface UnifiSettings {
  enabled: boolean;
  base_url: string | null;
  username: string | null;
  site: string | null;
  verify_tls: boolean;
  has_password: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface UnifiSite {
  id: string;
  name: string;
  description: string | null;
}

export interface UnifiSyncRun {
  id: number;
  status: string;
  trigger_source: string;
  message: string | null;
  stats_json: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface UnifiVlanPreview {
  network_id: string;
  name: string;
  vlan_tag: number;
  subnet: string | null;
  purpose: string | null;
}

export interface Role {
  id: number;
  name: string;
  description: string | null;
}

export interface RoleMatrixHost {
  id: number;
  name: string;
  environment_id: number;
  host_type_id: number;
}

export interface RoleMatrixRole {
  id: number;
  name: string;
  description: string | null;
}

export interface RoleMatrixAssignment {
  host_id: number;
  role_id: number;
  priority: number;
}

export interface RoleMatrixResponse {
  hosts: RoleMatrixHost[];
  roles: RoleMatrixRole[];
  assignments: RoleMatrixAssignment[];
}

export interface RoleMatrixToggleRequest {
  host_id: number;
  role_id: number;
  priority?: number;
}

export interface RoleMatrixToggleResponse {
  host_id: number;
  role_id: number;
  action: "added" | "removed";
  priority: number | null;
}

export interface App {
  id: number;
  name: string;
  description: string | null;
}

export interface Datastore {
  id: number;
  name: string;
  description: string | null;
}

export interface Domain {
  id: number;
  fqdn: string;
}

export interface K3sCluster {
  id: number;
  name: string;
  environment_id: number;
}

export interface K3sClusterApp {
  cluster_id: number;
  app_id: number;
}


export interface Host {
  id: number;
  environment_id: number;
  host_type_id: number;
  name: string;
  vlan_id: number;
  ipv4: string;
  mac: string | null;
  role_ids: number[];
  status_id: number | null;
  k3s_cluster_id: number | null;
  proxmox_host_id: number | null;
  proxmox_node: string | null;
  domain_internal_id: number | null;
  domain_external_id: number | null;
  notes: string | null;
  last_synced_at: string | null;
  unifi_observed_ip: string | null;
  effective_ipv4: string | null;
  unifi_network_name: string | null;
  unifi_vlan_tag: number | null;
  unifi_last_seen_at: string | null;
  unifi_port_forward_count: number;
  unifi_port_forwards: UnifiPortForward[];
}

export interface HostResource {
  id: number;
  host_id: number;
  cpu_sockets: number;
  cpu_cores: number;
  ram_mb: number;
}

export interface HostStorage {
  id: number;
  host_id: number;
  purpose: string;
  datastore_id: number;
  size_gb: number;
}

export interface HostApp {
  host_id: number;
  app_id: number;
}

export interface AppField {
  id: number;
  app_id: number;
  name: string;
  default_value: string | null;
  is_secret: boolean;
}

export interface HostAppField {
  host_id: number;
  app_id: number;
  field_id: number;
  value: string | null;
  field_name?: string;
  is_secret: boolean;
}

export interface RoleField {
  id: number;
  role_id: number;
  name: string;
  default_value: string | null;
  is_secret: boolean;
}

export interface HostRoleField {
  host_id: number;
  field_id: number;
  value: string | null;
  field_name?: string;
  is_secret: boolean;
}

export interface StatusField {
  id: number;
  status_id: number;
  name: string;
  default_value: string | null;
  is_secret: boolean;
}

export interface HostStatusField {
  host_id: number;
  field_id: number;
  value: string | null;
  field_name?: string;
  is_secret: boolean;
}

export interface AnsibleDefault {
  id: number;
  name: string;
  value: string | null;
  is_secret: boolean;
}

export interface HostAnsibleVar {
  host_id: number;
  var_id: number;
  value: string | null;
  var_name?: string;
  is_secret: boolean;
}


export interface InventoryRow {
  id: number;
  env: string | null;
  type: string | null;
  name: string | null;
  vlan_id: number | null;
  ipv4: string | null;
  mac: string | null;
  role: string | null;
  k3s_cluster: string | null;
  apps: string | null;
  proxmox_host: string | null;
  vm_cpu_socket: number | null;
  vm_cpu_core: number | null;
  vm_ram: string | null;
  vm_storage_os_datastore: string | null;
  vm_storage_os_size: string | null;
  vm_storage_hdd01_datastore: string | null;
  vm_storage_hdd01_size: string | null;
  domain_internal: string | null;
  external_domain: string | null;
  notes: string | null;
  proxmox_node: string | null;
  last_synced_at: string | null;
  status: string | null;
}

export type ProxmoxAuthType = "token" | "password";

export interface ProxmoxCredential {
  id: number;
  name: string;
  base_url: string;
  auth_type: ProxmoxAuthType;
  token_id: string | null;
  username: string | null;
  verify_tls: boolean;
  is_active: boolean;
  has_secret: boolean;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

export interface ProxmoxSyncSchedule {
  id: number;
  enabled: boolean;
  cron_expression: string;
  timezone: string;
  updated_at: string;
}

export interface ProxmoxSyncRun {
  id: number;
  status: string;
  trigger_source: string;
  message: string | null;
  stats_json: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface ProxmoxNodeStorage {
  id: number;
  node: string;
  storage: string;
  datastore_id: number | null;
  storage_type: string | null;
  total_gb: number | null;
  used_gb: number | null;
  avail_gb: number | null;
  enabled: boolean;
  last_synced_at: string | null;
}

export interface ProxmoxPendingHost {
  id: number;
  sync_run_id: number | null;
  credential_id: number | null;
  vmid: number | null;
  host_id_override: number | null;
  name: string;
  vm_type: string;
  node: string | null;
  cpu_cores: number;
  ram_mb: number;
  disks_json: string | null;
  nets_json: string | null;
  environment_id: number | null;
  host_type_id: number | null;
  vlan_id: number | null;
  vlan_tag: number | null;
  role_id: number | null;
  ipv4: string | null;
  mac: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}


export type GitRepoType = "ansible" | "app";
export type GitAuthType = "none" | "https" | "ssh";
export type PlaybookHostSource = "inventory" | "repo";
export type PlaybookRunStatus = "pending" | "running" | "success" | "failed" | "cancelled";
export type InventoryFilterType = "all" | "environment" | "role" | "status" | "vlan" | "pattern" | "hosts";

export interface InventoryFilters {
  environment_ids?: number[];
  role_ids?: number[];
  status_ids?: number[];
  vlan_ids?: number[];
  host_ids?: number[];
  pattern?: string | null;
}

export interface GitRepo {
  id: number;
  name: string;
  url: string;
  branch: string;
  repo_type: GitRepoType;
  auth_type: GitAuthType;
  credential_id: number | null;
  credential_name: string | null;
  https_username: string | null;
  has_https_password: boolean;
  has_ssh_key: boolean;
  last_synced_at: string | null;
  created_at: string;
}

export interface GitRepoCreate {
  name: string;
  url: string;
  branch?: string;
  repo_type?: GitRepoType;
  auth_type?: GitAuthType;
  credential_id?: number | null;
  https_username?: string;
  https_password?: string;
  ssh_private_key?: string;
}

export interface GitCredential {
  id: number;
  name: string;
  auth_type: GitAuthType;
  https_username: string | null;
  has_https_password: boolean;
  has_ssh_key: boolean;
  created_at: string;
}

export interface GitCredentialCreate {
  name: string;
  auth_type: GitAuthType;
  https_username?: string;
  https_password?: string;
  ssh_private_key?: string;
}

export interface AnsiblePlaybook {
  id: number;
  repo_id: number;
  path: string;
}

export interface PlaybookRun {
  id: number;
  playbook_id: number;
  run_by_id: number;
  host_source: PlaybookHostSource;
  target_host_ids: number[] | null;
  inventory_filter_type: InventoryFilterType | null;
  inventory_filter_value: unknown;
  extra_vars: Record<string, unknown> | null;
  job_template_id: number | null;
  status: PlaybookRunStatus;
  output: string | null;
  exit_code: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface PlaybookRunCreate {
  playbook_id: number;
  host_source?: PlaybookHostSource;
  target_host_ids?: number[];
  inventory_filter_type?: InventoryFilterType;
  inventory_filter_value?: unknown;
  extra_vars?: Record<string, unknown>;
}

export interface AppImportField {
  name: string;
  default_value: string | null;
  is_secret_hint: boolean;
}

export interface AppImportPreview {
  suggested_name: string;
  fields: AppImportField[];
}

export interface BulkAppImportPreview {
  category: string | null;
  subpath: string;
  suggested_name: string;
  fields: AppImportField[];
}

export interface BulkAppImportItem {
  app_name: string;
  category?: string | null;
  subpath: string;
  fields: AppImportField[];
}

export interface HostRoleEntry {
  host_id: number;
  role_id: number;
  priority: number;
}

export interface GlobalDefaultRole {
  role_id: number;
  priority: number;
}

export interface HostTypeRole {
  host_type_id: number;
  role_id: number;
  priority: number;
}

export interface HostTypeField {
  id: number;
  host_type_id: number;
  name: string;
  default_value: string | null;
  is_secret: boolean;
}

export interface HostHostTypeField {
  host_id: number;
  field_id: number;
  value: string | null;
}

export type InventoryExplorerGroupCategory = "environment" | "role" | "type" | "vlan" | "status" | "k3s" | "app" | "datastore";
export type InventoryExplorerOverrideKind = "ansible_default" | "status_field" | "role_field" | "app_field" | "host_type_field";

export interface InventoryExplorerHost {
  id: number;
  name: string;
  ipv4: string | null;
  environment: string | null;
  host_type: string | null;
  status: string | null;
  roles: string[];
  apps: string[];
}

export interface InventoryExplorerGroup {
  name: string;
  label: string;
  category: InventoryExplorerGroupCategory;
}

export interface InventoryExplorerOverrideTarget {
  kind: InventoryExplorerOverrideKind;
  target_id: number | null;
  target_name: string | null;
  app_id: number | null;
  label: string;
}

export interface InventoryExplorerLineageEntry {
  layer_key: string;
  layer_label: string;
  precedence: number;
  source_kind: string;
  source_label: string;
  value: string | null;
  is_secret: boolean;
  applied: boolean;
  editable: boolean;
  override_target: InventoryExplorerOverrideTarget | null;
}

export interface InventoryExplorerVar {
  key: string;
  value: string | null;
  is_secret: boolean;
  source_label: string | null;
  source_layer: string | null;
  editable: boolean;
  edit_reason: string | null;
  override_target: InventoryExplorerOverrideTarget | null;
  has_host_override: boolean;
  lineage: InventoryExplorerLineageEntry[];
}

export interface InventoryExplorerData {
  host: InventoryExplorerHost;
  groups: InventoryExplorerGroup[];
  vars: InventoryExplorerVar[];
}

export interface InventoryExplorerOverrideWrite {
  key: string;
  kind: InventoryExplorerOverrideKind;
  target_id: number | null;
  target_name?: string | null;
  app_id?: number | null;
  value?: string | null;
  remove?: boolean;
}

export interface AnsibleRolePreview {
  name: string;
  description: string | null;
  defaults: Record<string, string | null>;
}

export interface RoleImportItem {
  name: string;
  description?: string | null;
  import_defaults: boolean;
}

export interface RoleImportResult {
  requested: number;
  created: number;
  skipped: number;
  errors: Array<{ name: string; detail: string }>;
}

export interface VaultCredential {
  id: number;
  name: string;
  has_password: boolean;
  created_at: string;
}

export interface VaultCredentialCreate {
  name: string;
  vault_password?: string | null;
}

export interface JobTemplate {
  id: number;
  name: string;
  description: string | null;
  playbook_id: number | null;
  inventory_filter_type: InventoryFilterType;
  inventory_filter_value: unknown;
  inventory_filters?: InventoryFilters | null;
  extra_vars: Record<string, unknown> | null;
  vault_credential_id: number | null;
  runbook_enabled: boolean;
  runbook_category: string | null;
  recommended_when: string | null;
  risk_level: string | null;
  alert_match_type: string | null;
  alert_match_value: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobTemplateCreate {
  name: string;
  description?: string | null;
  playbook_id?: number | null;
  inventory_filter_type?: InventoryFilterType;
  inventory_filter_value?: unknown;
  inventory_filters?: InventoryFilters | null;
  extra_vars?: Record<string, unknown> | null;
  vault_credential_id?: number | null;
  runbook_enabled?: boolean;
  runbook_category?: string | null;
  recommended_when?: string | null;
  risk_level?: string | null;
  alert_match_type?: string | null;
  alert_match_value?: string | null;
}

export interface JobTemplateSchedule {
  id: number;
  job_template_id: number;
  cron_expr: string;
  is_enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
}

export interface JobTemplateScheduleCreate {
  cron_expr: string;
  is_enabled: boolean;
}

export type JobTemplatePreviewConfidence = "direct" | "dynamic" | "unknown";

export interface JobTemplatePreviewHost {
  host_id: number;
  hostname: string;
  ipv4: string | null;
  groups: string[];
  matched_by: string[];
  matched_groups: string[];
  matched_play_names: string[];
  filter_reason: string | null;
}

export interface JobTemplatePreviewTask {
  name: string;
  kind: string;
  source_path: string;
  confidence: JobTemplatePreviewConfidence;
  dynamic_reason: string | null;
  tags: string[];
  children: JobTemplatePreviewTask[];
}

export interface JobTemplatePreviewPlayHostMatch {
  host_id: number;
  hostname: string;
  matched_by: string[];
  matched_groups: string[];
  target_reason: string | null;
}

export interface JobTemplatePreviewPlay {
  name: string;
  hosts_pattern: string;
  confidence: JobTemplatePreviewConfidence;
  matched_host_ids: number[];
  matched_hostnames: string[];
  host_matches: JobTemplatePreviewPlayHostMatch[];
  tasks: JobTemplatePreviewTask[];
}

export interface JobTemplatePreview {
  job_template_id: number;
  playbook_id: number | null;
  playbook_path: string | null;
  repo_commit_sha: string | null;
  generated_at: string;
  template_fingerprint: string;
  inventory_fingerprint: string;
  confidence: JobTemplatePreviewConfidence;
  target_hosts: JobTemplatePreviewHost[];
  unmatched_patterns: string[];
  dynamic_reasons: string[];
  plays: JobTemplatePreviewPlay[];
}

export interface GitRepoSyncResult {
  repo_id: number;
  synced_playbooks: number;
  message: string;
}
