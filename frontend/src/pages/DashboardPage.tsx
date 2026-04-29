import { CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, LockOutlined, PlusOutlined, RadarChartOutlined, SettingOutlined, SyncOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Checkbox, Collapse, Descriptions, Divider, Drawer, Form, Grid, Input, Modal, Popconfirm, Popover, Select, Space, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { getRecord, listRecords, updateRecord } from "../api/crud";
import { listProxmoxSyncRuns } from "../api/proxmox";
import { getMonitoringHistory, getMonitoringLogs, getMonitoringOverview } from "../api/monitoring";
import PrometheusHistorySection from "../components/PrometheusHistorySection";
import { useAuth } from "../store/AuthContext";
import type {
  AnsibleDefault,
  App,
  AppField,
  Domain,
  Environment,
  Host,
  HostAnsibleVar,
  HostApp,
  HostAppField,
  MonitoringLogEntry,
  HostRoleField,
  HostStatus,
  HostStatusField,
  HostType,
  InventoryRow,
  K3sCluster,
  ProxmoxSyncRun,
  Role,
  RoleField,
  StatusField,
  Vlan,
} from "../types";

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

/** Hosts not synced within this many hours are flagged stale. */
const STALE_HOURS = 48;

function isStale(lastSynced: string | null): boolean {
  if (!lastSynced) return false;
  const diff = Date.now() - new Date(lastSynced).getTime();
  return diff > STALE_HOURS * 60 * 60 * 1000;
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const HOST_LOG_NOISE_PATTERNS = [
  "grafana alloy",
  "scrape manager",
  "finished transferring logs",
  "tail routine",
  "filetarget",
  "positions saved",
  "ts=",
  "caller=",
  "level=debug",
  "/metrics",
];

function hostLogIsNoise(entry: MonitoringLogEntry): boolean {
  const haystack = `${entry.service_name ?? ""} ${entry.level ?? ""} ${entry.line}`.toLowerCase();
  return HOST_LOG_NOISE_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function averageMetric(values: Array<number | null | undefined>): string {
  const present = values.filter((value): value is number => value != null && !Number.isNaN(value));
  if (present.length === 0) return "—";
  const avg = present.reduce((sum, value) => sum + value, 0) / present.length;
  return `${avg.toFixed(1)}%`;
}

const ALL_COLUMNS: ColumnsType<InventoryRow> = [
  { title: "ID",           dataIndex: "id",                        key: "id",                        width: 70,  fixed: "left" as const, sorter: (a, b) => a.id - b.id },
  { title: "Name",         dataIndex: "name",                      key: "name",                      width: 160, sorter: (a, b) => (a.name ?? "").localeCompare(b.name ?? "") },
  { title: "Env",          dataIndex: "env",                       key: "env",                       width: 80,  render: (v: string) => v ? <Tag>{v}</Tag> : null, sorter: (a, b) => (a.env ?? "").localeCompare(b.env ?? "") },
  { title: "Type",         dataIndex: "type",                      key: "type",                      width: 80,  sorter: (a, b) => (a.type ?? "").localeCompare(b.type ?? "") },
  { title: "Status",       dataIndex: "status",                    key: "status",                    width: 100, render: (v: string) => v ? <Tag>{v}</Tag> : null, sorter: (a, b) => (a.status ?? "").localeCompare(b.status ?? "") },
  { title: "VLAN",         dataIndex: "vlan_id",                   key: "vlan_id",                   width: 70,  sorter: (a, b) => (a.vlan_id ?? 0) - (b.vlan_id ?? 0) },
  { title: "IP",           dataIndex: "ipv4",                      key: "ipv4",                      width: 130, sorter: (a, b) => (a.ipv4 ?? "").localeCompare(b.ipv4 ?? "", undefined, { numeric: true }) },
  { title: "MAC",          dataIndex: "mac",                       key: "mac",                       width: 150 },
  { title: "Role",         dataIndex: "role",                      key: "role",                      width: 140, sorter: (a, b) => (a.role ?? "").localeCompare(b.role ?? "") },
  { title: "K3s Cluster",  dataIndex: "k3s_cluster",               key: "k3s_cluster",               width: 130 },
  { title: "Apps",         dataIndex: "apps",                      key: "apps",                      width: 200 },
  { title: "Proxmox Host", dataIndex: "proxmox_host",              key: "proxmox_host",              width: 130 },
  { title: "PVE Node",     dataIndex: "proxmox_node",              key: "proxmox_node",              width: 110 },
  { title: "CPU Sockets",  dataIndex: "vm_cpu_socket",             key: "vm_cpu_socket",             width: 100 },
  { title: "CPU Cores",    dataIndex: "vm_cpu_core",               key: "vm_cpu_core",               width: 90 },
  { title: "RAM",          dataIndex: "vm_ram",                    key: "vm_ram",                    width: 80 },
  { title: "OS Store",     dataIndex: "vm_storage_os_datastore",   key: "vm_storage_os_datastore",   width: 120 },
  { title: "OS Size",      dataIndex: "vm_storage_os_size",        key: "vm_storage_os_size",        width: 90 },
  { title: "HDD01 Store",  dataIndex: "vm_storage_hdd01_datastore",key: "vm_hdd01",                  width: 120 },
  { title: "HDD01 Size",   dataIndex: "vm_storage_hdd01_size",     key: "vm_hdd01_size",             width: 90 },
  { title: "Domain Int.",  dataIndex: "domain_internal",           key: "domain_internal",           width: 180 },
  { title: "Domain Ext.",  dataIndex: "external_domain",           key: "external_domain",           width: 180 },
  { title: "Notes",        dataIndex: "notes",                     key: "notes",                     width: 200 },
  {
    title: "Last Synced",
    dataIndex: "last_synced_at",
    key: "last_synced_at",
    width: 130,
    sorter: (a, b) => (a.last_synced_at ?? "").localeCompare(b.last_synced_at ?? ""),
    render: (v: string | null) => {
      if (!v) return null;
      const stale = isStale(v);
      return (
        <Tooltip title={new Date(v).toLocaleString()}>
          <span>
            {stale && <WarningOutlined style={{ color: "#faad14", marginRight: 4 }} />}
            <Text type={stale ? "warning" : undefined}>{timeAgo(v)}</Text>
          </span>
        </Tooltip>
      );
    },
  },
];

// Fields used for the free-text search
const SEARCH_FIELDS: (keyof InventoryRow)[] = [
  "name", "env", "type", "ipv4", "mac", "role",
  "k3s_cluster", "apps", "proxmox_host", "proxmox_node",
  "domain_internal", "external_domain", "notes",
];

/** Filter-dropdown field configs. */
const FILTER_FIELDS = [
  { key: "env" as const, label: "Environment", width: 140 },
  { key: "type" as const, label: "Type", width: 110 },
  { key: "status" as const, label: "Status", width: 130 },
  { key: "role" as const, label: "Role", width: 140 },
  { key: "vlan_id" as const, label: "VLAN", width: 100 },
  { key: "proxmox_host" as const, label: "Proxmox Host", width: 150 },
] as const;

type FilterKey = (typeof FILTER_FIELDS)[number]["key"];
type Filters = Partial<Record<FilterKey, string[]>>;

const COL_STORAGE_KEY = "dashboard_hidden_cols";

function loadHiddenCols(): Set<string> {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}


interface HostDetailPanelProps {
  row: InventoryRow;
  onClose: () => void;
  editRequestNonce?: number;
}

function HostDetailPanel({ row, onClose, editRequestNonce }: HostDetailPanelProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [editTab, setEditTab] = useState<"details" | "monitoring" | "appvars" | "rolevars" | "statusvars" | "ansiblevars">("details");
  const [varForms, setVarForms] = useState<Record<number, Record<string, string>>>({});
  const [roleVarForm, setRoleVarForm] = useState<Record<string, string>>({});
  const [statusVarForm, setStatusVarForm] = useState<Record<string, string>>({});
  const [ansibleVarForm, setAnsibleVarForm] = useState<Record<string, string>>({});
  const [addAppId, setAddAppId] = useState<number | null>(null);
  const [monitoringHistoryHours, setMonitoringHistoryHours] = useState(24);
  const [monitoringServiceFilter, setMonitoringServiceFilter] = useState<string | undefined>(undefined);
  const [monitoringSearch, setMonitoringSearch] = useState("");
  const [hideNoiseLogs, setHideNoiseLogs] = useState(true);
  const [form] = Form.useForm();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const { data: envData }     = useQuery({ queryKey: ["/environments"],  queryFn: () => listRecords<Environment>("/environments", 0, 500) });
  const { data: htData }      = useQuery({ queryKey: ["/host-types"],    queryFn: () => listRecords<HostType>("/host-types", 0, 500) });
  const { data: statusData }  = useQuery({ queryKey: ["/host-statuses"], queryFn: () => listRecords<HostStatus>("/host-statuses", 0, 500) });
  const { data: vlanData }    = useQuery({ queryKey: ["/vlans"],         queryFn: () => listRecords<Vlan>("/vlans", 0, 500) });
  const { data: roleData }    = useQuery({ queryKey: ["/roles"],         queryFn: () => listRecords<Role>("/roles", 0, 500) });
  const { data: clusterData } = useQuery({ queryKey: ["/k3s-clusters"],  queryFn: () => listRecords<K3sCluster>("/k3s-clusters", 0, 500) });
  const { data: allHostData } = useQuery({ queryKey: ["/hosts"],         queryFn: () => listRecords<Host>("/hosts", 0, 500) });
  const { data: domainData }  = useQuery({ queryKey: ["/domains"],       queryFn: () => listRecords<Domain>("/domains", 0, 500) });

  const { data: appsData } = useQuery({ queryKey: ["/apps"], queryFn: () => listRecords<App>("/apps", 0, 500) });
  const { data: allAppFields } = useQuery({
    queryKey: ["/app-fields"],
    queryFn: () => api.get<AppField[]>("/app-fields").then((r) => r.data),
  });
  const { data: hostApps = [] } = useQuery({
    queryKey: ["/host-apps", row.id],
    queryFn: () =>
      api.get<HostApp[]>("/host-apps", { params: { host_id: row.id } }).then((r) => r.data),
  });
  const { data: hostAppFields = [] } = useQuery({
    queryKey: ["/host-app-fields", row.id],
    queryFn: () =>
      api.get<HostAppField[]>("/host-app-fields", { params: { host_id: row.id } }).then((r) => r.data),
    enabled: hostApps.length > 0,
  });

  const { data: hostRecord } = useQuery({
    queryKey: ["/hosts", row.id],
    queryFn: () => getRecord<Host>("/hosts", row.id),
  });

  const { data: allRoleFields = [] } = useQuery({
    queryKey: ["/role-fields"],
    queryFn: () => api.get<RoleField[]>("/role-fields").then((r) => r.data),
  });
  const { data: hostRoleFields = [] } = useQuery({
    queryKey: ["/host-role-fields", row.id],
    queryFn: () =>
      api.get<HostRoleField[]>("/host-role-fields", { params: { host_id: row.id } }).then((r) => r.data),
  });

  const { data: allStatusFields = [] } = useQuery({
    queryKey: ["/status-fields"],
    queryFn: () => api.get<StatusField[]>("/status-fields").then((r) => r.data),
  });
  const { data: hostStatusFields = [] } = useQuery({
    queryKey: ["/host-status-fields", row.id],
    queryFn: () =>
      api.get<HostStatusField[]>("/host-status-fields", { params: { host_id: row.id } }).then((r) => r.data),
  });

  const { data: ansibleDefaults = [] } = useQuery({
    queryKey: ["/ansible-defaults"],
    queryFn: () => api.get<AnsibleDefault[]>("/ansible-defaults").then((r) => r.data),
  });
  const { data: hostAnsibleVars = [] } = useQuery({
    queryKey: ["/host-ansible-vars", row.id],
    queryFn: () =>
      api.get<HostAnsibleVar[]>("/host-ansible-vars", { params: { host_id: row.id } }).then((r) => r.data),
  });

  const { data: monitoringOverview, isFetching: monitoringOverviewFetching } = useQuery({
    queryKey: ["/monitoring/overview", "host-panel", row.id],
    queryFn: () => getMonitoringOverview(row.id),
    enabled: editOpen,
    refetchInterval: editOpen ? 30_000 : false,
  });

  const { data: monitoringLogs, isFetching: monitoringLogsFetching } = useQuery({
    queryKey: ["/monitoring/logs", "host-panel", row.id, monitoringServiceFilter],
    queryFn: () => getMonitoringLogs(monitoringServiceFilter, 100, row.id),
    enabled: editOpen,
    refetchInterval: editOpen ? 20_000 : false,
  });
  const { data: monitoringHistory, isFetching: monitoringHistoryFetching } = useQuery({
    queryKey: ["/monitoring/history", "host-panel", row.id, monitoringHistoryHours],
    queryFn: () => getMonitoringHistory(monitoringHistoryHours, row.id),
    enabled: editOpen,
    refetchInterval: editOpen ? 60_000 : false,
  });

  useEffect(() => {
    if (editOpen && hostRecord) {
      form.setFieldsValue(hostRecord);
      const initial: Record<number, Record<string, string>> = {};
      const allFields = allAppFields ?? [];
      for (const v of hostAppFields) {
        if (!initial[v.app_id]) initial[v.app_id] = {};
        // Don't pre-fill secret fields — user must explicitly enter a new value
        const field = allFields.find((f) => f.id === v.field_id);
        if (!field?.is_secret) {
          initial[v.app_id][String(v.field_id)] = v.value ?? "";
        }
      }
      setVarForms(initial);

      // Init role var form from existing per-host overrides
      const roleInit: Record<string, string> = {};
      for (const v of hostRoleFields) {
        if (!v.is_secret) roleInit[String(v.field_id)] = v.value ?? "";
      }
      setRoleVarForm(roleInit);

      // Init status var form from existing per-host overrides
      const statusInit: Record<string, string> = {};
      for (const v of hostStatusFields) {
        if (!v.is_secret) statusInit[String(v.field_id)] = v.value ?? "";
      }
      setStatusVarForm(statusInit);

      // Init ansible var form from existing per-host overrides
      const ansibleInit: Record<string, string> = {};
      for (const v of hostAnsibleVars) {
        if (!v.is_secret) ansibleInit[String(v.var_id)] = v.value ?? "";
      }
      setAnsibleVarForm(ansibleInit);

      setAddAppId(null);
      setEditTab("details");
      setMonitoringHistoryHours(24);
      setMonitoringServiceFilter(undefined);
      setMonitoringSearch("");
      setHideNoiseLogs(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOpen, hostRecord, form]);

  useEffect(() => {
    if (editRequestNonce) {
      setEditOpen(true);
    }
  }, [editRequestNonce]);

  const envOpts     = (envData?.items     ?? []).map((e) => ({ value: e.id, label: e.name }));
  const htOpts      = (htData?.items      ?? []).map((e) => ({ value: e.id, label: e.name }));
  const statusOpts  = (statusData?.items  ?? []).map((e) => ({ value: e.id, label: e.name }));
  const vlanOpts    = (vlanData?.items    ?? []).map((e) => ({ value: e.id, label: `VLAN ${e.vlan_id}` }));
  const roleOpts    = (roleData?.items    ?? []).map((e) => ({ value: e.id, label: e.name }));
  const clusterOpts = (clusterData?.items ?? []).map((e) => ({ value: e.id, label: e.name }));
  const proxHostOpts = (allHostData?.items ?? [])
    .filter((h) => h.id !== row.id)
    .map((e) => ({ value: e.id, label: `${e.name} (${e.id})` }));
  const domainOpts  = (domainData?.items  ?? []).map((e) => ({ value: e.id, label: e.fqdn }));
  const assignedAppIds = new Set(hostApps.map((ha) => ha.app_id));
  const unassignedAppOpts = (appsData?.items ?? [])
    .filter((a) => !assignedAppIds.has(a.id))
    .map((a) => ({ value: a.id, label: a.name }));

  const updateMut = useMutation({
    mutationFn: (vals: Record<string, unknown>) =>
      updateRecord<Host>("/hosts", row.id, vals),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/inventory"] });
      qc.invalidateQueries({ queryKey: ["/hosts"] });
      qc.invalidateQueries({ queryKey: ["/hosts", row.id] });
      setEditOpen(false);
      form.resetFields();
      onClose();
      message.success("Host updated");
    },
    onError: (e: unknown) =>
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Update failed"
      ),
  });

  const addAppMut = useMutation({
    mutationFn: (appId: number) =>
      api.post("/host-apps", { host_id: row.id, app_id: appId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/host-apps", row.id] });
      qc.invalidateQueries({ queryKey: ["/inventory"] });
      setAddAppId(null);
      message.success("App added");
    },
    onError: (e: unknown) =>
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to add app"
      ),
  });

  const removeAppMut = useMutation({
    mutationFn: (appId: number) =>
      api.delete("/host-apps", { params: { host_id: row.id, app_id: appId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/host-apps", row.id] });
      qc.invalidateQueries({ queryKey: ["/host-app-fields", row.id] });
      qc.invalidateQueries({ queryKey: ["/inventory"] });
      message.success("App removed");
    },
    onError: (e: unknown) =>
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to remove app"
      ),
  });

  async function saveAllVars() {
    const allFields = allAppFields ?? [];
    const saves = Object.entries(varForms).map(([appIdStr, fieldMap]) => {
      const appId = Number(appIdStr);
      const appFields = allFields.filter((f) => f.app_id === appId);
      const values = appFields
        // Omit secret fields where the user left the value blank (meaning no change)
        .filter((f) => !f.is_secret || (fieldMap[String(f.id)] ?? "") !== "")
        .map((f) => ({
          field_id: f.id,
          value: fieldMap[String(f.id)] ?? "",
        }));
      if (values.length === 0) return Promise.resolve();
      return api.put("/host-app-fields", { host_id: row.id, app_id: appId, values });
    });
    if (saves.length > 0) {
      await Promise.all(saves);
      qc.invalidateQueries({ queryKey: ["/host-app-fields", row.id] });
    }
  }

  async function saveRoleVars() {
    const roleId = (hostRecord?.role_ids ?? [])[0];
    if (!roleId) return;
    const roleFields = allRoleFields.filter((f) => f.role_id === roleId);
    if (roleFields.length === 0) return;
    const values = roleFields
      .filter((f) => !f.is_secret || (roleVarForm[String(f.id)] ?? "") !== "")
      .map((f) => ({
        field_id: f.id,
        value: roleVarForm[String(f.id)] ?? null,
      }));
    if (values.length === 0) return;
    await api.put("/host-role-fields", { host_id: row.id, values });
    qc.invalidateQueries({ queryKey: ["/host-role-fields", row.id] });
  }

  async function saveStatusVars() {
    const statusId = hostRecord?.status_id;
    if (!statusId) return;
    const statusFields = allStatusFields.filter((f) => f.status_id === statusId);
    if (statusFields.length === 0) return;
    const values = statusFields
      .filter((f) => !f.is_secret || (statusVarForm[String(f.id)] ?? "") !== "")
      .map((f) => ({
        field_id: f.id,
        value: statusVarForm[String(f.id)] ?? null,
      }));
    if (values.length === 0) return;
    await api.put("/host-status-fields", { host_id: row.id, values });
    qc.invalidateQueries({ queryKey: ["/host-status-fields", row.id] });
  }

  async function saveAnsibleVars() {
    if (ansibleDefaults.length === 0) return;
    const values = ansibleDefaults
      .filter((d) => !d.is_secret || (ansibleVarForm[String(d.id)] ?? "") !== "")
      .map((d) => ({
        var_id: d.id,
        value: ansibleVarForm[String(d.id)] ?? null,
      }));
    if (values.length === 0) return;
    await api.put("/host-ansible-vars", { host_id: row.id, values });
    qc.invalidateQueries({ queryKey: ["/host-ansible-vars", row.id] });
  }

  async function submitEdit() {
    const vals = await form.validateFields();
    const clean = Object.fromEntries(
      Object.entries(vals as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== "")
    );
    try {
      await Promise.all([updateMut.mutateAsync(clean), saveAllVars(), saveRoleVars(), saveStatusVars(), saveAnsibleVars()]);
    } catch { /* individual mutations handle their own errors */ }
  }

  const appVarGroups = useMemo(() => {
    const apps = appsData?.items ?? [];
    const allFields = allAppFields ?? [];
    const valueMap = new Map<number, string | null>();
    for (const v of hostAppFields) {
      valueMap.set(v.field_id, v.value ?? null);
    }
    return hostApps.map((ha) => {
      const app = apps.find((a) => a.id === ha.app_id);
      const fields = allFields.filter((f) => f.app_id === ha.app_id);
      return {
        appId: ha.app_id,
        appName: app?.name ?? `App ${ha.app_id}`,
        fields: fields.map((f) => ({
          id: f.id,
          name: f.name,
          value: valueMap.get(f.id) ?? null,
          isSet: valueMap.has(f.id),
          defaultValue: f.default_value ?? null,
          isSecret: f.is_secret,
        })),
      };
    });
  }, [hostApps, appsData, allAppFields, hostAppFields]);

  const hasApps = hostApps.length > 0;
  const monitoringHost = (monitoringOverview?.hosts ?? []).find((host) => {
    const instance = host.instance.toLowerCase();
    return instance.includes((row.name ?? "").toLowerCase()) || (!!row.ipv4 && instance.includes(row.ipv4.toLowerCase()));
  }) ?? monitoringOverview?.hosts?.[0];
  const monitoringServices = (monitoringOverview?.log_volume ?? []).map((item) => ({
    value: item.service_name,
    label: `${item.service_name} (${item.lines_last_hour.toLocaleString()}/hr)`,
  }));
  const filteredMonitoringLogs = useMemo(() => {
    const search = monitoringSearch.trim().toLowerCase();
    return (monitoringLogs?.items ?? []).filter((entry) => {
      if (hideNoiseLogs && hostLogIsNoise(entry)) {
        return false;
      }
      if (!search) {
        return true;
      }
      const haystack = `${entry.service_name ?? ""} ${entry.level ?? ""} ${entry.instance ?? ""} ${entry.line}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [hideNoiseLogs, monitoringLogs?.items, monitoringSearch]);
  const monitoringConfigured = Boolean(monitoringOverview?.prometheus.configured || monitoringOverview?.loki.configured);
  const monitoringStatusSummary = !monitoringOverview
    ? "Loading monitoring data."
    : !monitoringConfigured
      ? "Prometheus and Loki are not configured."
      : [
          monitoringOverview.prometheus.configured
            ? `Prometheus ${monitoringOverview.prometheus.reachable ? "online" : "offline"}`
            : "Prometheus disabled",
          monitoringOverview.loki.configured
            ? `Loki ${monitoringOverview.loki.reachable ? "online" : "offline"}`
            : "Loki disabled",
        ].join(" · ");

  const roleVarGroup = useMemo(() => {
    const roleId = (hostRecord?.role_ids ?? [])[0];
    if (!roleId) return null;
    const roleFields = allRoleFields.filter((f) => f.role_id === roleId);
    if (roleFields.length === 0) return null;
    const valueMap = new Map<number, string | null>();
    for (const v of hostRoleFields) {
      valueMap.set(v.field_id, v.value ?? null);
    }
    return {
      roleName: row.role ?? `Role ${roleId}`,
      fields: roleFields.map((f) => ({
        id: f.id,
        name: f.name,
        value: valueMap.get(f.id) ?? null,
        isSet: valueMap.has(f.id),
        defaultValue: f.default_value ?? null,
        isSecret: f.is_secret,
      })),
    };
  }, [hostRecord, allRoleFields, hostRoleFields, row.role]);

  const statusVarGroup = useMemo(() => {
    const statusId = hostRecord?.status_id;
    if (!statusId) return null;
    const statusFields = allStatusFields.filter((f) => f.status_id === statusId);
    if (statusFields.length === 0) return null;
    const valueMap = new Map<number, string | null>();
    for (const v of hostStatusFields) {
      valueMap.set(v.field_id, v.value ?? null);
    }
    return {
      statusName: statusData?.items?.find((s) => s.id === statusId)?.name ?? `Status ${statusId}`,
      fields: statusFields.map((f) => ({
        id: f.id,
        name: f.name,
        value: valueMap.get(f.id) ?? null,
        isSet: valueMap.has(f.id),
        defaultValue: f.default_value ?? null,
        isSecret: f.is_secret,
      })),
    };
  }, [hostRecord, allStatusFields, hostStatusFields, statusData]);

  const ansibleVarGroup = useMemo(() => {
    if (ansibleDefaults.length === 0) return null;
    const valueMap = new Map<number, string | null>();
    for (const v of hostAnsibleVars) {
      valueMap.set(v.var_id, v.value ?? null);
    }
    return ansibleDefaults.map((d) => ({
      id: d.id,
      name: d.name,
      globalDefault: d.value ?? null,
      hostValue: valueMap.get(d.id) ?? null,
      isOverridden: valueMap.has(d.id),
      isSecret: d.is_secret,
    }));
  }, [ansibleDefaults, hostAnsibleVars]);

  const generalItems: Array<{ label: string; value: string | number | null | undefined }> = [
    { label: "ID",              value: row.id },
    { label: "Name",            value: row.name },
    { label: "Environment",     value: row.env },
    { label: "Type",            value: row.type },
    { label: "VLAN",            value: row.vlan_id },
    { label: "IPv4",            value: row.ipv4 },
    { label: "MAC",             value: row.mac },
    { label: "Role",            value: row.role },
    { label: "K3s Cluster",     value: row.k3s_cluster },
    { label: "Apps",            value: row.apps },
    { label: "Proxmox Host",    value: row.proxmox_host },
    { label: "PVE Node",        value: row.proxmox_node },
    { label: "CPU Sockets",     value: row.vm_cpu_socket },
    { label: "CPU Cores",       value: row.vm_cpu_core },
    { label: "RAM",             value: row.vm_ram },
    { label: "OS Datastore",    value: row.vm_storage_os_datastore },
    { label: "OS Size",         value: row.vm_storage_os_size },
    { label: "HDD01 Datastore", value: row.vm_storage_hdd01_datastore },
    { label: "HDD01 Size",      value: row.vm_storage_hdd01_size },
    { label: "Internal Domain", value: row.domain_internal },
    { label: "External Domain", value: row.external_domain },
    { label: "Notes",           value: row.notes },
    {
      label: "Last Synced",
      value: row.last_synced_at
        ? `${new Date(row.last_synced_at).toLocaleString()}${isStale(row.last_synced_at) ? " ⚠ stale" : ""}`
        : null,
    },
  ];

  const panelTabItems = [
    {
      key: "general",
      label: "General",
      children: (
        <div style={{ maxHeight: "calc(100vh - 280px)", overflowY: "auto", padding: "4px 8px 8px" }}>
          <Descriptions column={1} bordered size="small">
            {generalItems.map((item) => (
              <Descriptions.Item key={item.label} label={item.label}>
                {item.value != null ? String(item.value) : <Text type="secondary">—</Text>}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </div>
      ),
    },
    {
      key: "appvars",
      label: "App Variables",
      disabled: !hasApps,
      children: (
        <div style={{ maxHeight: "calc(100vh - 280px)", overflowY: "auto", padding: "4px 8px 8px" }}>
          {appVarGroups.length === 0 ? (
            <Text type="secondary">No app variables defined for this host&apos;s apps.</Text>
          ) : (
            appVarGroups.map((group) => (
              <div key={group.appId} style={{ marginBottom: 16 }}>
                <Tag color="blue" style={{ marginBottom: 6 }}>{group.appName}</Tag>
                {group.fields.length === 0 ? (
                  <div><Text type="secondary" style={{ fontSize: 12 }}>No fields defined for this app.</Text></div>
                ) : (
                  <Descriptions column={1} bordered size="small">
                    {group.fields.map((f) => (
                      <Descriptions.Item
                        key={f.id}
                        label={<Text code style={{ fontSize: 11 }}>{f.name}{f.isSecret && <LockOutlined style={{ marginLeft: 4, color: "#d46b08" }} />}</Text>}
                      >
                        {f.isSecret
                          ? (f.isSet && f.value !== null
                              ? <Text type="secondary" italic><LockOutlined /> ••••••</Text>
                              : f.defaultValue !== null
                                ? <Text type="secondary" italic><LockOutlined /> ••••••</Text>
                                : <Text type="secondary" italic>not set</Text>)
                          : (f.isSet
                              ? (f.value !== null ? f.value : <Text type="secondary">—</Text>)
                              : f.defaultValue !== null
                                ? <Text type="secondary" italic title="App default">{f.defaultValue}</Text>
                                : <Text type="secondary" italic>not set</Text>)
                        }
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                )}
              </div>
            ))
          )}
        </div>
      ),
    },
    {
      key: "rolevars",
      label: "Role Vars",
      disabled: !roleVarGroup,
      children: (
        <div style={{ maxHeight: "calc(100vh - 280px)", overflowY: "auto", padding: "4px 8px 8px" }}>
          {!roleVarGroup ? (
            <Text type="secondary">No fields defined for this host&apos;s role.</Text>
          ) : (
            <div>
              <Tag color="purple" style={{ marginBottom: 8 }}>{roleVarGroup.roleName}</Tag>
              <Descriptions column={1} bordered size="small">
                {roleVarGroup.fields.map((f) => (
                  <Descriptions.Item
                    key={f.id}
                    label={<Text code style={{ fontSize: 11 }}>{f.name}{f.isSecret && <LockOutlined style={{ marginLeft: 4, color: "#d46b08" }} />}</Text>}
                  >
                    {f.isSecret
                      ? (f.isSet && f.value !== null
                          ? <Text type="secondary" italic><LockOutlined /> ••••••</Text>
                          : f.defaultValue !== null
                            ? <Text type="secondary" italic><LockOutlined /> ••••••</Text>
                            : <Text type="secondary" italic>not set</Text>)
                      : (f.isSet
                          ? (f.value !== null ? f.value : <Text type="secondary">—</Text>)
                          : f.defaultValue !== null
                            ? <Text type="secondary" italic title="Role default">{f.defaultValue}</Text>
                            : <Text type="secondary" italic>not set</Text>)
                    }
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "statusvars",
      label: "Status Vars",
      disabled: !statusVarGroup,
      children: (
        <div style={{ maxHeight: "calc(100vh - 280px)", overflowY: "auto", padding: "4px 8px 8px" }}>
          {!statusVarGroup ? (
            <Text type="secondary">No fields defined for this host&apos;s status.</Text>
          ) : (
            <div>
              <Tag color="orange" style={{ marginBottom: 8 }}>{statusVarGroup.statusName}</Tag>
              <Descriptions column={1} bordered size="small">
                {statusVarGroup.fields.map((f) => (
                  <Descriptions.Item
                    key={f.id}
                    label={<Text code style={{ fontSize: 11 }}>{f.name}{f.isSecret && <LockOutlined style={{ marginLeft: 4, color: "#d46b08" }} />}</Text>}
                  >
                    {f.isSecret
                      ? (f.isSet && f.value !== null
                          ? <Text type="secondary" italic><LockOutlined /> ••••••</Text>
                          : f.defaultValue !== null
                            ? <Text type="secondary" italic><LockOutlined /> ••••••</Text>
                            : <Text type="secondary" italic>not set</Text>)
                      : (f.isSet
                          ? (f.value !== null ? f.value : <Text type="secondary">—</Text>)
                          : f.defaultValue !== null
                            ? <Text type="secondary" italic title="Status default">{f.defaultValue}</Text>
                            : <Text type="secondary" italic>not set</Text>)
                    }
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "ansiblevars",
      label: "Ansible Vars",
      disabled: !ansibleVarGroup,
      children: (
        <div style={{ maxHeight: "calc(100vh - 280px)", overflowY: "auto", padding: "4px 8px 8px" }}>
          {!ansibleVarGroup ? (
            <Text type="secondary">No global Ansible defaults configured.</Text>
          ) : (
            <Descriptions column={1} bordered size="small">
              {ansibleVarGroup.map((v) => (
                <Descriptions.Item
                  key={v.id}
                  label={<Text code style={{ fontSize: 11 }}>{v.name}{v.isSecret && <LockOutlined style={{ marginLeft: 4, color: "#d46b08" }} />}</Text>}
                >
                  {v.isSecret
                    ? (v.isOverridden || v.globalDefault !== null
                        ? <Text type="secondary" italic><LockOutlined /> ••••••</Text>
                        : <Text type="secondary" italic>not set</Text>)
                    : (v.isOverridden
                        ? (v.hostValue !== null
                            ? <span title="Host override">{v.hostValue}</span>
                            : <Text type="secondary">—</Text>)
                        : v.globalDefault !== null
                          ? <Text type="secondary" italic title="Global default">{v.globalDefault}</Text>
                          : <Text type="secondary" italic>not set</Text>)
                  }
                </Descriptions.Item>
              ))}
            </Descriptions>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={{ width: "100%", border: "1px solid #303030", borderRadius: 8, overflow: "hidden" }}>
        {/* Panel header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 14px",
          borderBottom: "1px solid #303030",
        }}>
          <Text strong>{row.name ?? "Host"} ({row.id})</Text>
          <Space size={4}>
            <Button
              size="small"
              icon={<RadarChartOutlined />}
              onClick={() => navigate(`/inventory/explorer?host=${row.id}`)}
            >
              Explorer
            </Button>
            {isAdmin && (
              <Button size="small" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            )}
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
          </Space>
        </div>
        {/* Tabs */}
        <Tabs size="small" style={{ padding: "0 4px" }} items={panelTabItems} />
      </div>

      {/* Edit Host modal */}
      <Modal
        title={`Edit — ${row.name ?? "Host"} (${row.id})`}
        open={editOpen}
        onCancel={() => { setEditOpen(false); form.resetFields(); setVarForms({}); setRoleVarForm({}); setStatusVarForm({}); setAnsibleVarForm({}); setAddAppId(null); }}
        onOk={submitEdit}
        confirmLoading={updateMut.isPending}
        destroyOnClose
        width={isMobile ? "100%" : 860}
        style={isMobile ? { top: 0, margin: 0, padding: 0, maxWidth: "100vw" } : undefined}
        styles={isMobile ? { body: { maxHeight: "80vh", overflowY: "auto" } } : undefined}
      >
        <Tabs
          activeKey={editTab}
          onChange={(k) => setEditTab(k as "details" | "monitoring" | "appvars" | "rolevars" | "statusvars" | "ansiblevars")}
          style={{ marginTop: 8 }}
          items={[
            {
              key: "details",
              label: "Host Details",
              children: (
                <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 8 }}>
                  <Form form={form} layout="vertical">
                    <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                      Core host fields stay expanded. Less-used infrastructure mappings are grouped below.
                    </Text>
                    <Collapse
                      bordered={false}
                      defaultActiveKey={["identity", "placement"]}
                      items={[
                        {
                          key: "identity",
                          label: "Identity",
                          children: (
                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                                gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
                              }}
                            >
                              <Form.Item name="name" label="Name" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                                <Input />
                              </Form.Item>
                              <Form.Item name="ipv4" label="IPv4" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                                <Input />
                              </Form.Item>
                              <Form.Item name="mac" label="MAC Address" style={{ marginBottom: 0 }}>
                                <Input />
                              </Form.Item>
                              <Form.Item name="notes" label="Notes" style={{ marginBottom: 0, gridColumn: isMobile ? "auto" : "1 / -1" }}>
                                <Input.TextArea rows={3} />
                              </Form.Item>
                            </div>
                          ),
                        },
                        {
                          key: "placement",
                          label: "Inventory Placement",
                          children: (
                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                                gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
                              }}
                            >
                              <Form.Item name="environment_id" label="Environment" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                                <Select
                                  options={envOpts}
                                  showSearch
                                  filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                                />
                              </Form.Item>
                              <Form.Item name="host_type_id" label="Host Type" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                                <Select
                                  options={htOpts}
                                  showSearch
                                  filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                                />
                              </Form.Item>
                              <Form.Item name="role_id" label="Role" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                                <Select
                                  options={roleOpts}
                                  showSearch
                                  filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                                />
                              </Form.Item>
                              <Form.Item name="status_id" label="Status" style={{ marginBottom: 0 }}>
                                <Select
                                  options={statusOpts}
                                  allowClear
                                  showSearch
                                  filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                                />
                              </Form.Item>
                              <Form.Item name="vlan_id" label="VLAN" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                                <Select
                                  options={vlanOpts}
                                  showSearch
                                  filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                                />
                              </Form.Item>
                              <Form.Item name="k3s_cluster_id" label="K3s Cluster" style={{ marginBottom: 0 }}>
                                <Select
                                  options={clusterOpts}
                                  allowClear
                                  showSearch
                                  filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                                />
                              </Form.Item>
                            </div>
                          ),
                        },
                        {
                          key: "domains",
                          label: "Domains",
                          children: (
                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                                gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
                              }}
                            >
                              <Form.Item name="domain_internal_id" label="Domain Internal" style={{ marginBottom: 0 }}>
                                <Select
                                  options={domainOpts}
                                  allowClear
                                  showSearch
                                  filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                                />
                              </Form.Item>
                              <Form.Item name="domain_external_id" label="Domain External" style={{ marginBottom: 0 }}>
                                <Select
                                  options={domainOpts}
                                  allowClear
                                  showSearch
                                  filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                                />
                              </Form.Item>
                            </div>
                          ),
                        },
                        {
                          key: "proxmox",
                          label: "Proxmox Mapping",
                          children: (
                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                                gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
                              }}
                            >
                              <Form.Item name="proxmox_host_id" label="Proxmox Host" style={{ marginBottom: 0 }}>
                                <Select
                                  options={proxHostOpts}
                                  allowClear
                                  showSearch
                                  filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                                />
                              </Form.Item>
                              <Form.Item name="proxmox_node" label="PVE Node Name" style={{ marginBottom: 0 }}>
                                <Input />
                              </Form.Item>
                            </div>
                          ),
                        },
                      ]}
                    />
                  </Form>
                </div>
              ),
            },
            {
              key: "monitoring",
              label: "Monitoring",
              children: (
                <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 8 }}>
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Text type="secondary">{monitoringStatusSummary}</Text>
                    {!monitoringConfigured && (
                      <Text type="secondary">
                        Configure Prometheus and/or Loki to populate host metrics and logs here.
                      </Text>
                    )}
                    {monitoringConfigured && (
                      <>
                        <div
                          style={{
                            display: "grid",
                            gap: 12,
                            gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
                          }}
                        >
                          <div style={{ border: "1px solid #303030", borderRadius: 8, padding: 12 }}>
                            <Text strong style={{ display: "block", marginBottom: 8 }}>Host Metrics</Text>
                            {monitoringOverviewFetching ? (
                              <Text type="secondary">Refreshing metrics…</Text>
                            ) : monitoringHost ? (
                              <Descriptions column={1} size="small" bordered>
                                <Descriptions.Item label="Status">
                                  <Tag color={monitoringHost.up ? "green" : "red"}>
                                    {monitoringHost.up ? "up" : "down"}
                                  </Tag>
                                </Descriptions.Item>
                                <Descriptions.Item label="Instance">
                                  {monitoringHost.instance}
                                </Descriptions.Item>
                                <Descriptions.Item label="CPU">
                                  {monitoringHost.cpu_usage_percent != null ? `${monitoringHost.cpu_usage_percent.toFixed(1)}%` : <Text type="secondary">—</Text>}
                                </Descriptions.Item>
                                <Descriptions.Item label="Memory">
                                  {monitoringHost.memory_usage_percent != null ? `${monitoringHost.memory_usage_percent.toFixed(1)}%` : <Text type="secondary">—</Text>}
                                </Descriptions.Item>
                                <Descriptions.Item label="Root Disk">
                                  {monitoringHost.root_disk_usage_percent != null ? `${monitoringHost.root_disk_usage_percent.toFixed(1)}%` : <Text type="secondary">—</Text>}
                                </Descriptions.Item>
                              </Descriptions>
                            ) : (
                              <Text type="secondary">No Prometheus metrics matched this host.</Text>
                            )}
                          </div>
                          <div style={{ border: "1px solid #303030", borderRadius: 8, padding: 12 }}>
                            <Text strong style={{ display: "block", marginBottom: 8 }}>Monitoring Summary</Text>
                            <Descriptions column={1} size="small" bordered>
                              <Descriptions.Item label="Targets">
                                {monitoringOverview?.prometheus.configured ? monitoringOverview.targets.total_targets : <Text type="secondary">disabled</Text>}
                              </Descriptions.Item>
                              <Descriptions.Item label="Healthy Targets">
                                {monitoringOverview?.prometheus.configured ? monitoringOverview.targets.healthy_targets : <Text type="secondary">disabled</Text>}
                              </Descriptions.Item>
                              <Descriptions.Item label="Avg Host CPU">
                                {monitoringOverview?.prometheus.configured ? averageMetric((monitoringOverview?.hosts ?? []).map((host) => host.cpu_usage_percent)) : <Text type="secondary">disabled</Text>}
                              </Descriptions.Item>
                              <Descriptions.Item label="Avg Host Memory">
                                {monitoringOverview?.prometheus.configured ? averageMetric((monitoringOverview?.hosts ?? []).map((host) => host.memory_usage_percent)) : <Text type="secondary">disabled</Text>}
                              </Descriptions.Item>
                              <Descriptions.Item label="Services Logging">
                                {monitoringOverview?.loki.configured ? monitoringOverview.log_volume.length : <Text type="secondary">disabled</Text>}
                              </Descriptions.Item>
                            </Descriptions>
                          </div>
                        </div>

                        <PrometheusHistorySection
                          history={monitoringHistory}
                          loading={monitoringHistoryFetching}
                          hours={monitoringHistoryHours}
                          onHoursChange={setMonitoringHistoryHours}
                          title="Prometheus Host Trend History"
                        />

                        <div style={{ border: "1px solid #303030", borderRadius: 8, padding: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                            <Text strong>Recent Host Logs</Text>
                            <Space wrap>
                              <Checkbox checked={hideNoiseLogs} onChange={(e) => setHideNoiseLogs(e.target.checked)}>
                                Hide noise
                              </Checkbox>
                              <Select
                                allowClear
                                placeholder="Service"
                                style={{ width: isMobile ? 140 : 180 }}
                                value={monitoringServiceFilter}
                                options={monitoringServices}
                                onChange={(value) => setMonitoringServiceFilter(value)}
                              />
                              <Input.Search
                                allowClear
                                placeholder="Filter logs"
                                value={monitoringSearch}
                                onChange={(e) => setMonitoringSearch(e.target.value)}
                                style={{ width: isMobile ? 160 : 220 }}
                              />
                              <Button
                                onClick={() => {
                                  setHideNoiseLogs(false);
                                  setMonitoringServiceFilter(undefined);
                                  setMonitoringSearch("");
                                }}
                              >
                                Clear Filters
                              </Button>
                            </Space>
                          </div>
                          <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                            Noise filtering hides common Alloy, scrape, and debug chatter by default.
                          </Text>
                          <div style={{ display: "grid", gap: 8 }}>
                            {monitoringLogsFetching && <Text type="secondary">Refreshing logs…</Text>}
                            {filteredMonitoringLogs.length === 0 ? (
                              <Text type="secondary">
                                {monitoringOverview?.loki.configured
                                  ? "No logs matched the current host filters."
                                  : "Loki is not configured for host log visibility."}
                              </Text>
                            ) : (
                              filteredMonitoringLogs.slice(0, 40).map((entry) => (
                                <div key={`${entry.timestamp}-${entry.line.slice(0, 24)}`} style={{ border: "1px solid #303030", borderRadius: 8, padding: 10 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                                    <Space wrap size={6}>
                                      <Tag>{entry.service_name || "unknown"}</Tag>
                                      {entry.level && <Tag color={entry.level === "info" ? "blue" : entry.level === "error" ? "red" : "default"}>{entry.level}</Tag>}
                                      {entry.instance && <Text type="secondary">{entry.instance}</Text>}
                                    </Space>
                                    <Text type="secondary">{new Date(entry.timestamp).toLocaleString()}</Text>
                                  </div>
                                  <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                                    {entry.line}
                                  </Typography.Paragraph>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </Space>
                </div>
              ),
            },
            {
              key: "appvars",
              label: "App Variables",
              children: (
                <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 10 }}>
                  {appVarGroups.length === 0 && (
                    <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                      No apps assigned to this host yet.
                    </Text>
                  )}
                  {appVarGroups.map((group) => (
                    <div key={group.appId}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <Tag color="blue" style={{ fontSize: 13 }}>{group.appName}</Tag>
                        <Popconfirm
                          title={`Remove ${group.appName} from this host?`}
                          onConfirm={() => removeAppMut.mutate(group.appId)}
                          okText="Remove"
                          okButtonProps={{ danger: true }}
                        >
                          <Button size="small" danger icon={<DeleteOutlined />} loading={removeAppMut.isPending} />
                        </Popconfirm>
                      </div>
                      {group.fields.length === 0 ? (
                        <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
                          No fields defined for this app.
                        </Text>
                      ) : (
                        group.fields.map((f) => (
                          <div key={f.id} style={{ marginBottom: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <Text code style={{ fontSize: 12 }}>{f.name}{f.isSecret && <LockOutlined style={{ marginLeft: 4, color: "#d46b08" }} />}</Text>
                              {!f.isSecret && f.defaultValue !== null && (
                                <Text type="secondary" style={{ fontSize: 11 }}>default: {f.defaultValue}</Text>
                              )}
                            </div>
                            {f.isSecret ? (
                              <Input.Password
                                visibilityToggle={false}
                                placeholder="Enter new value to change"
                                value={varForms[group.appId]?.[String(f.id)] ?? ""}
                                onChange={(e) =>
                                  setVarForms((prev) => ({
                                    ...prev,
                                    [group.appId]: { ...(prev[group.appId] ?? {}), [String(f.id)]: e.target.value },
                                  }))
                                }
                              />
                            ) : (
                              <Input
                                placeholder={f.defaultValue ?? "no default"}
                                value={varForms[group.appId]?.[String(f.id)] ?? f.value ?? ""}
                                onChange={(e) =>
                                  setVarForms((prev) => ({
                                    ...prev,
                                    [group.appId]: { ...(prev[group.appId] ?? {}), [String(f.id)]: e.target.value },
                                  }))
                                }
                              />
                            )}
                          </div>
                        ))
                      )}
                      <Divider style={{ margin: "10px 0" }} />
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                    <Select
                      style={{ flex: 1 }}
                      placeholder="Add an app…"
                      options={unassignedAppOpts}
                      value={addAppId}
                      onChange={(v) => setAddAppId(v ?? null)}
                      showSearch
                      filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                      allowClear
                      onClear={() => setAddAppId(null)}
                    />
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      disabled={addAppId === null}
                      loading={addAppMut.isPending}
                      onClick={() => { if (addAppId !== null) addAppMut.mutate(addAppId); }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: "rolevars",
              label: "Role Variables",
              children: (
                <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 10 }}>
                  {!roleVarGroup ? (
                    <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                      No fields defined for this host&apos;s role. Configure role fields on the Roles page.
                    </Text>
                  ) : (
                    <>
                      <Tag color="purple" style={{ marginBottom: 12, fontSize: 13 }}>{roleVarGroup.roleName}</Tag>
                      {roleVarGroup.fields.map((f) => (
                        <div key={f.id} style={{ marginBottom: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text code style={{ fontSize: 12 }}>{f.name}{f.isSecret && <LockOutlined style={{ marginLeft: 4, color: "#d46b08" }} />}</Text>
                            {!f.isSecret && f.defaultValue !== null && (
                              <Text type="secondary" style={{ fontSize: 11 }}>default: {f.defaultValue}</Text>
                            )}
                          </div>
                          {f.isSecret ? (
                            <Input.Password
                              visibilityToggle={false}
                              placeholder="Enter new value to change"
                              value={roleVarForm[String(f.id)] ?? ""}
                              onChange={(e) =>
                                setRoleVarForm((prev) => ({ ...prev, [String(f.id)]: e.target.value }))
                              }
                            />
                          ) : (
                            <Input
                              placeholder={f.defaultValue ?? "no default"}
                              value={roleVarForm[String(f.id)] ?? f.value ?? ""}
                              onChange={(e) =>
                                setRoleVarForm((prev) => ({ ...prev, [String(f.id)]: e.target.value }))
                              }
                            />
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ),
            },
            {
              key: "statusvars",
              label: "Status Variables",
              children: (
                <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 10 }}>
                  {!statusVarGroup ? (
                    <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                      No fields defined for this host&apos;s status. Configure status fields on the Host Statuses page.
                    </Text>
                  ) : (
                    <>
                      <Tag color="orange" style={{ marginBottom: 12, fontSize: 13 }}>{statusVarGroup.statusName}</Tag>
                      {statusVarGroup.fields.map((f) => (
                        <div key={f.id} style={{ marginBottom: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text code style={{ fontSize: 12 }}>{f.name}{f.isSecret && <LockOutlined style={{ marginLeft: 4, color: "#d46b08" }} />}</Text>
                            {!f.isSecret && f.defaultValue !== null && (
                              <Text type="secondary" style={{ fontSize: 11 }}>default: {f.defaultValue}</Text>
                            )}
                          </div>
                          {f.isSecret ? (
                            <Input.Password
                              visibilityToggle={false}
                              placeholder="Enter new value to change"
                              value={statusVarForm[String(f.id)] ?? ""}
                              onChange={(e) =>
                                setStatusVarForm((prev) => ({ ...prev, [String(f.id)]: e.target.value }))
                              }
                            />
                          ) : (
                            <Input
                              placeholder={f.defaultValue ?? "no default"}
                              value={statusVarForm[String(f.id)] ?? f.value ?? ""}
                              onChange={(e) =>
                                setStatusVarForm((prev) => ({ ...prev, [String(f.id)]: e.target.value }))
                              }
                            />
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ),
            },
            {
              key: "ansiblevars",
              label: "Ansible Vars",
              children: (
                <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 10 }}>
                  {!ansibleVarGroup || ansibleVarGroup.length === 0 ? (
                    <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                      No global Ansible defaults configured. Add defaults on the Ansible Defaults page.
                    </Text>
                  ) : (
                    ansibleVarGroup.map((v) => (
                      <div key={v.id} style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text code style={{ fontSize: 12 }}>{v.name}{v.isSecret && <LockOutlined style={{ marginLeft: 4, color: "#d46b08" }} />}</Text>
                          {!v.isSecret && v.globalDefault !== null && (
                            <Text type="secondary" style={{ fontSize: 11 }}>global default: {v.globalDefault}</Text>
                          )}
                        </div>
                        {v.isSecret ? (
                          <Input.Password
                            visibilityToggle={false}
                            placeholder="Enter new value to change"
                            value={ansibleVarForm[String(v.id)] ?? ""}
                            onChange={(e) =>
                              setAnsibleVarForm((prev) => ({ ...prev, [String(v.id)]: e.target.value }))
                            }
                          />
                        ) : (
                          <Input
                            placeholder={v.globalDefault ?? "no global default"}
                            value={ansibleVarForm[String(v.id)] ?? v.hostValue ?? ""}
                            onChange={(e) =>
                              setAnsibleVarForm((prev) => ({ ...prev, [String(v.id)]: e.target.value }))
                            }
                          />
                        )}
                      </div>
                    ))
                  )}
                </div>
              ),
            },
          ]}
        />
      </Modal>
    </>
  );
}


export default function DashboardPage() {
  const { data, isFetching } = useQuery({
    queryKey: ["/inventory"],
    queryFn: () => listRecords<InventoryRow>("/inventory", 0, 500),
  });

  const { data: syncRunsData } = useQuery({
    queryKey: ["/proxmox/runs", "latest"],
    queryFn: () => listProxmoxSyncRuns(0, 1),
  });

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(loadHiddenCols);
  const [drawerRow, setDrawerRow] = useState<InventoryRow | null>(null);
  const [editRequest, setEditRequest] = useState<{ rowId: number; nonce: number } | null>(null);

  const screens = useBreakpoint();
  const isMobile = !screens.md;

  // Derive unique values for filter dropdowns from the full dataset
  const filterOptions = useMemo(() => {
    const rows = data?.items ?? [];
    const opts: Record<FilterKey, string[]> = { env: [], type: [], status: [], role: [], vlan_id: [], proxmox_host: [] };
    for (const ff of FILTER_FIELDS) {
      const unique = [...new Set(rows.map((r) => r[ff.key]).filter((v) => v != null).map(String))].sort();
      opts[ff.key] = unique;
    }
    return opts;
  }, [data]);

  const toggleCol = (key: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem(COL_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const visibleColumns = useMemo(
    () => ALL_COLUMNS.filter((c) => !hiddenCols.has(c.key as string)),
    [hiddenCols],
  );

  const filteredRows = useMemo(() => {
    let rows = data?.items ?? [];

    // Apply dropdown filters
    for (const ff of FILTER_FIELDS) {
      const vals = filters[ff.key];
      if (vals && vals.length > 0) {
        const set = new Set(vals);
        rows = rows.filter((r) => set.has(String(r[ff.key] ?? "")));
      }
    }

    // Apply free-text search
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) =>
        SEARCH_FIELDS.some((f) => String(row[f] ?? "").toLowerCase().includes(q)),
      );
    }

    return rows;
  }, [data, search, filters]);

  // Last global sync info
  const lastRun: ProxmoxSyncRun | undefined = syncRunsData?.items?.[0];

  const columnToggleContent = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0", maxHeight: 360, overflowY: "auto" }}>
      {ALL_COLUMNS.map((col) => (
        <Checkbox
          key={col.key as string}
          checked={!hiddenCols.has(col.key as string)}
          onChange={() => toggleCol(col.key as string)}
        >
          {col.title as string}
        </Checkbox>
      ))}
    </div>
  );

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <Space align="center" size="middle" wrap>
          <img src="/logo.svg" alt="SLIM" style={{ height: 48 }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>Inventory Overview</Title>
            <Text type="secondary">Host inventory, filters, exports, and inline host management.</Text>
          </div>
          {lastRun && (
            <Tooltip title={`Run #${lastRun.id} · ${lastRun.status} · ${lastRun.trigger_source}`}>
              <Tag
                icon={<SyncOutlined />}
                color={lastRun.status === "success" ? "green" : lastRun.status === "running" ? "processing" : "orange"}
              >
                Last sync: {lastRun.completed_at ? timeAgo(lastRun.completed_at) : lastRun.status}
              </Tag>
            </Tooltip>
          )}
        </Space>
        <Space wrap>
          <Popover
            title="Show / Hide Columns"
            content={columnToggleContent}
            trigger="click"
            placement="bottomRight"
          >
            <Button icon={<SettingOutlined />}>Columns</Button>
          </Popover>
          {!isMobile && (
            <>
              <Button icon={<DownloadOutlined />} href="/api/inventory/export" target="_blank">
                Export CSV
              </Button>
              <Button icon={<DownloadOutlined />} href="/api/inventory/ansible" target="_blank">
                Export Ansible Inventory
              </Button>
            </>
          )}
          {isMobile && (
            <Button icon={<DownloadOutlined />} href="/api/inventory/export" target="_blank" />
          )}
        </Space>
      </div>

      {/* ── Filters row ────────────────────────────────────── */}
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder="Search hosts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={setSearch}
          allowClear
          style={{ width: isMobile ? 160 : 220 }}
        />
        {FILTER_FIELDS.map((ff) => (
          <Select
            key={ff.key}
            mode="multiple"
            allowClear
            placeholder={ff.label}
            maxTagCount="responsive"
            style={{ minWidth: isMobile ? 100 : ff.width }}
            value={filters[ff.key] ?? []}
            onChange={(vals) => setFilters((prev) => ({ ...prev, [ff.key]: vals }))}
            options={filterOptions[ff.key].map((v) => ({ label: ff.key === "vlan_id" ? `VLAN ${v}` : v, value: v }))}
          />
        ))}
      </Space>

      {/* ── Table + Detail panel ───────────────────────────── */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Table<InventoryRow>
            dataSource={filteredRows}
            columns={visibleColumns}
            rowKey="id"
            loading={isFetching}
            size="small"
            scroll={{ x: "max-content" }}
            pagination={{ pageSize: 100, showSizeChanger: true, showTotal: (t, r) => `${r[0]}–${r[1]} of ${t}` }}
            onRow={(record) => ({
              onClick: () => setDrawerRow((prev) => prev?.id === record.id ? null : record),
              onDoubleClick: () => {
                setDrawerRow(record);
                setEditRequest({ rowId: record.id, nonce: Date.now() });
              },
              style: { cursor: "pointer" },
            })}
            rowClassName={(record) => record.id === drawerRow?.id ? "ant-table-row-selected" : ""}
          />
        </div>

        {/* Desktop inline detail panel */}
        {!isMobile && drawerRow && (
          <div style={{ width: 360, flexShrink: 0 }}>
            <HostDetailPanel
              row={drawerRow}
              onClose={() => setDrawerRow(null)}
              editRequestNonce={editRequest?.rowId === drawerRow.id ? editRequest.nonce : undefined}
            />
          </div>
        )}
      </div>

      {/* Mobile detail drawer */}
      {isMobile && (
        <Drawer
          open={!!drawerRow}
          onClose={() => setDrawerRow(null)}
          placement="bottom"
          height="80vh"
          title={drawerRow ? `${drawerRow.name ?? "Host"} (${drawerRow.id})` : ""}
          styles={{ body: { padding: 0 } }}
        >
          {drawerRow && (
            <HostDetailPanel
              row={drawerRow}
              onClose={() => setDrawerRow(null)}
              editRequestNonce={editRequest?.rowId === drawerRow.id ? editRequest.nonce : undefined}
            />
          )}
        </Drawer>
      )}
    </div>
  );
}
