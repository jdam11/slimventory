import {
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { PlusOutlined, UploadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  bulkDismissProxmoxPendingHosts,
  bulkPromoteProxmoxPendingHosts,
  createProxmoxCredential,
  deleteProxmoxCredential,
  dismissProxmoxPendingHost,
  getProxmoxSchedule,
  listProxmoxCredentials,
  listProxmoxNodeStorage,
  listProxmoxPendingHosts,
  listProxmoxSyncRuns,
  promoteProxmoxPendingHost,
  triggerProxmoxSync,
  updateProxmoxCredential,
  updateProxmoxPendingHost,
  updateProxmoxSchedule,
  importProxmoxCredentials,
  type ProxmoxCredentialInput,
  type ProxmoxCredentialImportItem,
  type ProxmoxPendingHostUpdate,
  type ProxmoxScheduleInput,
} from "../api/proxmox";
import yaml from "js-yaml";
import { getLogLevel, setLogLevel } from "../api/admin";
import { createRecord, listRecords } from "../api/crud";
import { useAuth } from "../store/AuthContext";
import { buildSortedOptions, buildVlanOption, filterSelectOption } from "../utils/selectOptions";
import type { Environment, HostType, ProxmoxCredential, ProxmoxNodeStorage, ProxmoxPendingHost, ProxmoxSyncRun, Role, Vlan } from "../types";

const { Title, Text } = Typography;

type CredentialFormValues = ProxmoxCredentialInput;

const CRON_HELP = "Cron format: minute hour day-of-month month day-of-week";

function isLikelyCron(value: string): boolean {
  return value.trim().split(/\s+/).length === 5;
}

export default function ProxmoxPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();

  const [credentialModalOpen, setCredentialModalOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<ProxmoxCredential | null>(null);
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [editingPending, setEditingPending] = useState<ProxmoxPendingHost | null>(null);
  const [selectedNicKey, setSelectedNicKey] = useState<string | null>(null);
  const [selectedPendingIds, setSelectedPendingIds] = useState<number[]>([]);
  const [bulkPendingEditOpen, setBulkPendingEditOpen] = useState(false);
  const [bulkPendingEditLoading, setBulkPendingEditLoading] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ProxmoxCredentialImportItem[]>([]);

  // inline quick-create state for each FK select in the pending host modal
  const [newEnvName, setNewEnvName] = useState("");
  const [newHostTypeName, setNewHostTypeName] = useState("");
  const [newVlanId, setNewVlanId] = useState<number | null>(null);
  const [newRoleName, setNewRoleName] = useState("");

  const [credentialForm] = Form.useForm<CredentialFormValues>();
  const [scheduleForm] = Form.useForm<ProxmoxScheduleInput>();
  const [pendingForm] = Form.useForm<ProxmoxPendingHostUpdate>();
  const [bulkPendingForm] = Form.useForm<ProxmoxPendingHostUpdate>();

  const { data: credentials, isFetching: credentialsLoading } = useQuery({
    queryKey: ["/proxmox/credentials"],
    queryFn: () => listProxmoxCredentials(0, 200),
  });

  const { data: schedule, isFetching: scheduleLoading } = useQuery({
    queryKey: ["/proxmox/schedule"],
    queryFn: getProxmoxSchedule,
  });

  useEffect(() => {
    if (schedule) {
      scheduleForm.setFieldsValue(schedule);
    }
  }, [schedule, scheduleForm]);

  const { data: runs, isFetching: runsLoading } = useQuery({
    queryKey: ["/proxmox/runs"],
    queryFn: () => listProxmoxSyncRuns(0, 50),
  });

  const { data: pendingHosts, isFetching: pendingLoading } = useQuery({
    queryKey: ["/proxmox/pending"],
    queryFn: () => listProxmoxPendingHosts(0, 100),
    enabled: isAdmin,
  });

  const { data: nodeStorage, isFetching: nodeStorageLoading } = useQuery({
    queryKey: ["/proxmox/node-storage"],
    queryFn: () => listProxmoxNodeStorage(0, 500),
  });

  const { data: environments } = useQuery({
    queryKey: ["/environments"],
    queryFn: () => listRecords<Environment>("/environments", 0, 500),
    enabled: isAdmin,
  });

  const { data: hostTypes } = useQuery({
    queryKey: ["/host-types"],
    queryFn: () => listRecords<HostType>("/host-types", 0, 500),
    enabled: isAdmin,
  });

  const { data: vlans } = useQuery({
    queryKey: ["/vlans"],
    queryFn: () => listRecords<Vlan>("/vlans", 0, 500),
    enabled: isAdmin,
  });

  const { data: roles } = useQuery({
    queryKey: ["/roles"],
    queryFn: () => listRecords<Role>("/roles", 0, 500),
    enabled: isAdmin,
  });

  const { data: logLevelData } = useQuery({
    queryKey: ["/admin/log-level"],
    queryFn: getLogLevel,
    enabled: isAdmin,
  });

  const [pendingLogLevel, setPendingLogLevel] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (logLevelData) setPendingLogLevel(logLevelData.log_level);
  }, [logLevelData]);

  const setLogLevelMut = useMutation({
    mutationFn: (level: string) => setLogLevel(level),
    onSuccess: (data) => {
      setPendingLogLevel(data.log_level);
      qc.invalidateQueries({ queryKey: ["/admin/log-level"] });
      message.success(`Log level set to ${data.log_level}`);
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to update log level"
      );
    },
  });

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["/proxmox/credentials"] }),
      qc.invalidateQueries({ queryKey: ["/proxmox/schedule"] }),
      qc.invalidateQueries({ queryKey: ["/proxmox/runs"] }),
      qc.invalidateQueries({ queryKey: ["/proxmox/pending"] }),
      qc.invalidateQueries({ queryKey: ["/proxmox/node-storage"] }),
      qc.invalidateQueries({ queryKey: ["/host-types"] }),
      qc.invalidateQueries({ queryKey: ["/vlans"] }),
      qc.invalidateQueries({ queryKey: ["/environments"] }),
      qc.invalidateQueries({ queryKey: ["/roles"] }),
    ]);
  };

  const createCredentialMut = useMutation({
    mutationFn: createProxmoxCredential,
    onSuccess: async () => {
      await invalidateAll();
      setCredentialModalOpen(false);
      credentialForm.resetFields();
      message.success("Credential created");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to create credential"
      );
    },
  });

  const updateCredentialMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ProxmoxCredentialInput> }) =>
      updateProxmoxCredential(id, payload),
    onSuccess: async () => {
      await invalidateAll();
      setCredentialModalOpen(false);
      setEditingCredential(null);
      credentialForm.resetFields();
      message.success("Credential updated");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to update credential"
      );
    },
  });

  const deleteCredentialMut = useMutation({
    mutationFn: deleteProxmoxCredential,
    onSuccess: async () => {
      await invalidateAll();
      message.success("Credential deleted");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to delete credential"
      );
    },
  });

  const importCredentialsMut = useMutation({
    mutationFn: importProxmoxCredentials,
    onSuccess: async (result) => {
      await invalidateAll();
      setImportModalOpen(false);
      setImportPreview([]);
      const parts: string[] = [];
      if (result.created) parts.push(`${result.created} created`);
      if (result.skipped) parts.push(`${result.skipped} skipped (duplicate)`);
      if (result.errors.length) parts.push(`${result.errors.length} failed`);
      message.success(`Import complete: ${parts.join(", ")}`);
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to import credentials"
      );
    },
  });

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        let parsed: unknown[];
        if (file.name.endsWith(".json")) {
          const json = JSON.parse(text);
          parsed = Array.isArray(json) ? json : [json];
        } else {
          const single = yaml.load(text);
          if (Array.isArray(single)) {
            parsed = single;
          } else {
            // Handle multi-document YAML (--- separated)
            const docs = yaml.loadAll(text);
            parsed = docs.flat();
          }
        }
        if (!parsed.length || typeof parsed[0] !== "object") {
          message.error("File must contain an array of credentials");
          return;
        }
        const items: ProxmoxCredentialImportItem[] = (parsed as Record<string, unknown>[]).map((entry) => ({
          name: String(entry.name || ""),
          base_url: String(entry.base_url || entry.url || ""),
          verify_tls: entry.verify_tls !== false,
          ...(entry.auth_type ? { auth_type: entry.auth_type as "token" | "password" } : {}),
          ...(entry.token_id ? { token_id: String(entry.token_id) } : {}),
          ...(entry.token_secret ? { token_secret: String(entry.token_secret) } : {}),
          ...(entry.username ? { username: String(entry.username) } : {}),
          ...(entry.password ? { password: String(entry.password) } : {}),
          ...(entry.is_active ? { is_active: true } : {}),
        }));
        const invalid = items.filter((i) => !i.name || !i.base_url);
        if (invalid.length) {
          message.error(`${invalid.length} entries missing name or url`);
          return;
        }
        setImportPreview(items);
        setImportModalOpen(true);
      } catch {
        message.error("Failed to parse file — ensure it is valid JSON or YAML");
      }
    };
    reader.readAsText(file);
  };

  const saveScheduleMut = useMutation({
    mutationFn: updateProxmoxSchedule,
    onSuccess: async () => {
      await invalidateAll();
      message.success("Schedule updated");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to update schedule"
      );
    },
  });

  const triggerSyncMut = useMutation({
    mutationFn: triggerProxmoxSync,
    onSuccess: async () => {
      await invalidateAll();
      message.success("Sync completed");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to trigger sync"
      );
    },
  });

  const updatePendingMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ProxmoxPendingHostUpdate }) =>
      updateProxmoxPendingHost(id, payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/proxmox/pending"] });
      setPendingModalOpen(false);
      setEditingPending(null);
      pendingForm.resetFields();
      message.success("Pending host updated");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to update pending host"
      );
    },
  });

  const promotePendingMut = useMutation({
    mutationFn: promoteProxmoxPendingHost,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/proxmox/pending"] }),
        qc.invalidateQueries({ queryKey: ["/hosts"] }),
      ]);
      message.success("Host promoted successfully");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to promote host"
      );
    },
  });

  const dismissPendingMut = useMutation({
    mutationFn: dismissProxmoxPendingHost,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/proxmox/pending"] });
      message.success("Host dismissed");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to dismiss host"
      );
    },
  });

  const bulkPromotePendingMut = useMutation({
    mutationFn: bulkPromoteProxmoxPendingHosts,
    onSuccess: async (result) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/proxmox/pending"] }),
        qc.invalidateQueries({ queryKey: ["/hosts"] }),
      ]);
      setSelectedPendingIds([]);
      if (result.errors.length === 0) {
        message.success(`Promoted ${result.succeeded} host${result.succeeded === 1 ? "" : "s"}`);
      } else {
        message.warning(
          `Promoted ${result.succeeded}/${result.requested}. ${result.errors.length} failed.`,
        );
      }
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to bulk promote hosts"
      );
    },
  });

  const bulkDismissPendingMut = useMutation({
    mutationFn: bulkDismissProxmoxPendingHosts,
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["/proxmox/pending"] });
      setSelectedPendingIds([]);
      if (result.errors.length === 0) {
        message.success(`Dismissed ${result.succeeded} host${result.succeeded === 1 ? "" : "s"}`);
      } else {
        message.warning(
          `Dismissed ${result.succeeded}/${result.requested}. ${result.errors.length} failed.`,
        );
      }
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to bulk dismiss hosts"
      );
    },
  });

  const selectedAuthType = Form.useWatch("auth_type", credentialForm) ?? "token";
  const selectedIsActive = Form.useWatch("is_active", credentialForm) ?? true;

  async function handleBulkPendingEdit() {
    const vals = bulkPendingForm.getFieldsValue() as ProxmoxPendingHostUpdate;
    const clean = Object.fromEntries(
      Object.entries(vals).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ) as ProxmoxPendingHostUpdate;
    if (Object.keys(clean).length === 0) {
      message.warning("Fill in at least one field to update");
      return;
    }
    setBulkPendingEditLoading(true);
    try {
      for (const id of selectedPendingIds) {
        await updateProxmoxPendingHost(id, clean);
      }
      await qc.invalidateQueries({ queryKey: ["/proxmox/pending"] });
      setBulkPendingEditOpen(false);
      bulkPendingForm.resetFields();
      message.success(`Updated ${selectedPendingIds.length} pending host(s)`);
    } catch (e: unknown) {
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Some updates failed"
      );
    } finally {
      setBulkPendingEditLoading(false);
    }
  }

  const credentialColumns: ColumnsType<ProxmoxCredential> = useMemo(
    () => [
      { title: "Name", dataIndex: "name", key: "name", width: 140 },
      { title: "URL", dataIndex: "base_url", key: "base_url", width: 240 },
      {
        title: "Auth",
        dataIndex: "auth_type",
        key: "auth_type",
        width: 100,
        render: (value: string) => <Tag color={value === "token" ? "blue" : "geekblue"}>{value}</Tag>,
      },
      {
        title: "Active",
        dataIndex: "is_active",
        key: "is_active",
        width: 90,
        render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "yes" : "no"}</Tag>,
      },
      {
        title: "Last Sync",
        dataIndex: "last_sync_at",
        key: "last_sync_at",
        width: 190,
        render: (value: string | null) => value ?? "-",
      },
      {
        title: "Secret",
        dataIndex: "has_secret",
        key: "has_secret",
        width: 90,
        render: (value: boolean) => <Tag color={value ? "green" : "orange"}>{value ? "set" : "missing"}</Tag>,
      },
      {
        title: "Actions",
        key: "actions",
        width: 180,
        render: (_: unknown, row: ProxmoxCredential) => (
          <Space>
            <Button
              size="small"
              disabled={!isAdmin}
              onClick={() => {
                setEditingCredential(row);
                credentialForm.setFieldsValue({
                  name: row.name,
                  base_url: row.base_url,
                  auth_type: row.auth_type,
                  token_id: row.token_id ?? undefined,
                  username: row.username ?? undefined,
                  verify_tls: row.verify_tls,
                  is_active: row.is_active,
                });
                setCredentialModalOpen(true);
              }}
            >
              Edit
            </Button>
            <Popconfirm
              title="Delete this credential?"
              onConfirm={() => deleteCredentialMut.mutate(row.id)}
              disabled={!isAdmin}
            >
              <Button size="small" danger disabled={!isAdmin}>
                Delete
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [credentialForm, deleteCredentialMut, isAdmin]
  );

  const runColumns: ColumnsType<ProxmoxSyncRun> = [
    { title: "Started", dataIndex: "started_at", key: "started_at", width: 200 },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (value: string) => (
        <Tag color={value === "success" ? "green" : value === "failed" ? "red" : "processing"}>
          {value}
        </Tag>
      ),
    },
    { title: "Trigger", dataIndex: "trigger_source", key: "trigger_source", width: 120 },
    { title: "Message", dataIndex: "message", key: "message" },
  ];

  const pendingColumns: ColumnsType<ProxmoxPendingHost> = useMemo(() => {
    const envMap = Object.fromEntries((environments?.items ?? []).map((e) => [e.id, e.name]));
    const typeMap = Object.fromEntries((hostTypes?.items ?? []).map((t) => [t.id, t.name]));
    const vlanMap = Object.fromEntries((vlans?.items ?? []).map((v) => [v.id, `VLAN ${v.vlan_id}`]));
    const roleMap = Object.fromEntries((roles?.items ?? []).map((r) => [r.id, r.name]));
    return [
      {
        title: "VMID",
        dataIndex: "vmid",
        key: "vmid",
        width: 80,
        render: (v: number | null, row: ProxmoxPendingHost) =>
          v != null ? v : row.host_id_override != null ? <Tag color="purple">{row.host_id_override}</Tag> : <Tag color="orange">unset</Tag>,
      },
      { title: "Name", dataIndex: "name", key: "name", width: 140 },
      { title: "Type", dataIndex: "vm_type", key: "vm_type", width: 80 },
      { title: "Node", dataIndex: "node", key: "node", width: 100, render: (v: string | null) => v ?? "-" },
      {
        title: "Source",
        dataIndex: "credential_id",
        key: "credential_id",
        width: 120,
        render: (v: number | null) => {
          const cred = (credentials?.items ?? []).find((c) => c.id === v);
          return cred ? <Tag color="blue">{cred.name}</Tag> : v != null ? <Tag color="orange">{v}</Tag> : "-";
        },
      },
      { title: "CPU", dataIndex: "cpu_cores", key: "cpu_cores", width: 70 },
      {
        title: "RAM",
        dataIndex: "ram_mb",
        key: "ram_mb",
        width: 90,
        render: (v: number) => `${Math.round(v / 1024)}GB`,
      },
      {
        title: "Environment",
        dataIndex: "environment_id",
        key: "environment_id",
        width: 120,
        render: (v: number | null) =>
          v ? <Tag color="blue">{envMap[v] ?? v}</Tag> : <Tag color="orange">missing</Tag>,
      },
      {
        title: "Host Type",
        dataIndex: "host_type_id",
        key: "host_type_id",
        width: 100,
        render: (v: number | null, row: ProxmoxPendingHost) => {
          if (!v) return <Tag color="orange">missing</Tag>;
          const name = typeMap[v] ?? (row.vm_type === "lxc" ? "lxc" : "vm");
          return <Tag>{name}</Tag>;
        },
      },
      {
        title: "VLAN",
        dataIndex: "vlan_id",
        key: "vlan_id",
        width: 100,
        render: (v: number | null, row: ProxmoxPendingHost) =>
          v != null
            ? <Tag>{vlanMap[v] ?? `VLAN ${v}`}</Tag>
            : row.vlan_tag != null
              ? <Tag color="orange">VLAN {row.vlan_tag} (unlinked)</Tag>
              : <Tag color="orange">missing</Tag>,
      },
      {
        title: "Role",
        dataIndex: "role_id",
        key: "role_id",
        width: 110,
        render: (v: number | null) =>
          v ? <Tag>{roleMap[v] ?? v}</Tag> : <Tag color="orange">missing</Tag>,
      },
      {
        title: "IP",
        dataIndex: "ipv4",
        key: "ipv4",
        width: 120,
        render: (v: string | null) => v ?? <Tag color="orange">missing</Tag>,
      },
      {
        title: "Actions",
        key: "actions",
        width: 220,
        render: (_: unknown, row: ProxmoxPendingHost) => {
          const canPromote =
            row.environment_id != null &&
            row.host_type_id != null &&
            row.vlan_id != null &&
            row.role_id != null &&
            row.ipv4 != null &&
            (row.vm_type !== "node" || row.host_id_override != null);
          return (
            <Space>
              <Button
                size="small"
                onClick={() => {
                  setEditingPending(row);
                  pendingForm.setFieldsValue({
                    environment_id: row.environment_id ?? undefined,
                    host_type_id: row.host_type_id ?? undefined,
                    vlan_id: row.vlan_id ?? undefined,
                    role_id: row.role_id ?? undefined,
                    ipv4: row.ipv4 ?? undefined,
                    mac: row.mac ?? undefined,
                    notes: row.notes ?? undefined,
                    host_id_override: row.host_id_override ?? undefined,
                  });
                  setPendingModalOpen(true);
                }}
              >
                Edit
              </Button>
              <Popconfirm
                title="Promote this VM to a real host?"
                disabled={!canPromote}
                onConfirm={() => promotePendingMut.mutate(row.id)}
              >
                <Button size="small" type="primary" disabled={!canPromote}>
                  Promote
                </Button>
              </Popconfirm>
              <Popconfirm
                title="Dismiss this pending host?"
                onConfirm={() => dismissPendingMut.mutate(row.id)}
              >
                <Button size="small" danger>
                  Dismiss
                </Button>
              </Popconfirm>
            </Space>
          );
        },
      },
    ];
  }, [environments, hostTypes, vlans, roles, credentials, pendingForm, promotePendingMut, dismissPendingMut]);

  const nodeStorageColumns: ColumnsType<ProxmoxNodeStorage> = [
    { title: "Node", dataIndex: "node", key: "node", width: 120 },
    { title: "Storage", dataIndex: "storage", key: "storage", width: 140 },
    { title: "Type", dataIndex: "storage_type", key: "storage_type", width: 100, render: (v: string | null) => v ?? "-" },
    {
      title: "Enabled",
      dataIndex: "enabled",
      key: "enabled",
      width: 80,
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "yes" : "no"}</Tag>,
    },
    {
      title: "Total",
      dataIndex: "total_gb",
      key: "total_gb",
      width: 90,
      render: (v: number | null) => v != null ? `${v} GB` : "-",
    },
    {
      title: "Used",
      dataIndex: "used_gb",
      key: "used_gb",
      width: 90,
      render: (v: number | null) => v != null ? `${v} GB` : "-",
    },
    {
      title: "Free",
      dataIndex: "avail_gb",
      key: "avail_gb",
      width: 90,
      render: (v: number | null) => v != null ? `${v} GB` : "-",
    },
    {
      title: "Usage",
      key: "usage",
      width: 140,
      render: (_: unknown, row: ProxmoxNodeStorage) => {
        if (row.total_gb == null || row.total_gb === 0) return "-";
        const usedGb = row.used_gb ?? 0;
        const pct = Math.round((usedGb / row.total_gb) * 100);
        const color = pct >= 90 ? "#ff4d4f" : pct >= 70 ? "#fa8c16" : "#52c41a";
        return (
          <Tooltip title={`${pct}% used`}>
            <div style={{ background: "#303030", borderRadius: 4, height: 12, width: "100%" }}>
              <div style={{ background: color, width: `${pct}%`, height: "100%", borderRadius: 4, minWidth: pct > 0 ? 4 : 0 }} />
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: "Last Synced",
      dataIndex: "last_synced_at",
      key: "last_synced_at",
      width: 160,
      render: (v: string | null) => v ? new Date(v).toLocaleString() : "-",
    },
  ];

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Title level={4} style={{ margin: 0 }}>
          Proxmox Integration
        </Title>
        <Button
          type="primary"
          onClick={() => triggerSyncMut.mutate({ trigger_source: "manual" })}
          loading={triggerSyncMut.isPending}
        >
          Run Sync Now
        </Button>
      </div>

      <Card
        title="Credentials"
        extra={
          isAdmin ? (
            <Space>
              <Button
                icon={<UploadOutlined />}
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = ".json,.yaml,.yml";
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) handleImportFile(file);
                  };
                  input.click();
                }}
              >
                Import
              </Button>
              <Button
                onClick={() => {
                  setEditingCredential(null);
                  credentialForm.resetFields();
                  credentialForm.setFieldsValue({ auth_type: "token", verify_tls: true, is_active: true });
                  setCredentialModalOpen(true);
                }}
              >
                Add Credential
              </Button>
            </Space>
          ) : undefined
        }
      >
        <Table<ProxmoxCredential>
          rowKey="id"
          columns={credentialColumns}
          dataSource={credentials?.items ?? []}
          loading={credentialsLoading}
          pagination={false}
          size="small"
          scroll={{ x: true }}
        />
      </Card>

      <Tabs
        defaultActiveKey="schedule"
        items={[
          {
            key: "schedule",
            label: "Schedule & Sync History",
            children: (
              <Space direction="vertical" style={{ width: "100%" }} size={16}>
                <Card title="Schedule">
                  <Form
                    form={scheduleForm}
                    layout="vertical"
                    initialValues={{ enabled: false, cron_expression: "0 * * * *", timezone: "UTC" }}
                    onFinish={(values) => saveScheduleMut.mutate(values)}
                  >
                    <Form.Item label="Enabled" name="enabled" valuePropName="checked">
                      <Switch disabled={!isAdmin} loading={scheduleLoading} />
                    </Form.Item>
                    <Form.Item
                      label="Cron Expression"
                      name="cron_expression"
                      extra={CRON_HELP}
                      rules={[
                        { required: true, message: "Cron expression is required" },
                        {
                          validator: async (_rule, value: string) => {
                            if (!isLikelyCron(value)) {
                              throw new Error("Cron must contain exactly 5 fields");
                            }
                          },
                        },
                      ]}
                    >
                      <Input disabled={!isAdmin} placeholder="0 * * * *" />
                    </Form.Item>
                    <Form.Item label="Timezone" name="timezone" rules={[{ required: true }]}>
                      <Input disabled={!isAdmin} placeholder="UTC" />
                    </Form.Item>
                    <Button htmlType="submit" type="primary" disabled={!isAdmin} loading={saveScheduleMut.isPending}>
                      Save Schedule
                    </Button>
                  </Form>
                </Card>

                <Card title="Recent Sync Runs">
                  <Table<ProxmoxSyncRun>
                    rowKey="id"
                    columns={runColumns}
                    dataSource={runs?.items ?? []}
                    loading={runsLoading}
                    pagination={false}
                    size="small"
                    scroll={{ x: true }}
                  />
                </Card>
              </Space>
            ),
          },
          ...(isAdmin
            ? [
                {
                  key: "pending",
                  label: (
                    <Space>
                      Pending Hosts
                      {(pendingHosts?.total ?? 0) > 0 && (
                        <Tag color="orange">{pendingHosts?.total}</Tag>
                      )}
                    </Space>
                  ),
                  children: (
                    <Card
                      extra={
                        <Space>
                          {selectedPendingIds.length > 0 && (
                            <Tag color="blue">{selectedPendingIds.length} selected</Tag>
                          )}
                          <Button
                            size="small"
                            disabled={selectedPendingIds.length === 0}
                            onClick={() => {
                              bulkPendingForm.resetFields();
                              setBulkPendingEditOpen(true);
                            }}
                          >
                            Bulk Edit
                          </Button>
                          <Button
                            size="small"
                            disabled={selectedPendingIds.length === 0}
                            loading={bulkPromotePendingMut.isPending}
                            onClick={() => bulkPromotePendingMut.mutate(selectedPendingIds)}
                          >
                            Bulk Promote
                          </Button>
                          <Popconfirm
                            title={`Dismiss ${selectedPendingIds.length} selected host${selectedPendingIds.length === 1 ? "" : "s"}?`}
                            disabled={selectedPendingIds.length === 0}
                            onConfirm={() => bulkDismissPendingMut.mutate(selectedPendingIds)}
                          >
                            <Button
                              size="small"
                              danger
                              disabled={selectedPendingIds.length === 0}
                              loading={bulkDismissPendingMut.isPending}
                            >
                              Bulk Dismiss
                            </Button>
                          </Popconfirm>
                          <Button
                            size="small"
                            disabled={selectedPendingIds.length === 0}
                            onClick={() => setSelectedPendingIds([])}
                          >
                            Clear
                          </Button>
                        </Space>
                      }
                    >
                      <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                        VMs queued during sync because required lookup tables had no defaults. Fill in the missing
                        fields then promote.
                      </Text>
                      <Table<ProxmoxPendingHost>
                        rowKey="id"
                        columns={pendingColumns}
                        dataSource={pendingHosts?.items ?? []}
                        loading={pendingLoading}
                        rowSelection={{
                          selectedRowKeys: selectedPendingIds,
                          onChange: (keys) => setSelectedPendingIds(keys as number[]),
                        }}
                        pagination={false}
                        size="small"
                        scroll={{ x: true }}
                        locale={{ emptyText: "No pending hosts — all synced VMs have been processed." }}
                      />
                    </Card>
                  ),
                },
              ]
            : []),
          {
            key: "storage",
            label: (
              <Space>
                Storage Pools
                {(nodeStorage?.total ?? 0) > 0 && (
                  <Tag color="blue">{nodeStorage?.total}</Tag>
                )}
              </Space>
            ),
            children: (
              <Card>
                <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                  Proxmox storage pool capacity synced per node. Pools are linked to datastores by name.
                </Text>
                <Table<ProxmoxNodeStorage>
                  rowKey="id"
                  columns={nodeStorageColumns}
                  dataSource={nodeStorage?.items ?? []}
                  loading={nodeStorageLoading}
                  pagination={false}
                  size="small"
                  scroll={{ x: true }}
                  locale={{ emptyText: "No storage pool data — run a sync to populate." }}
                />
              </Card>
            ),
          },
        ]}
      />

      {isAdmin && (
        <Card title="Admin Settings">
          <Space direction="vertical">
            <Text strong>Application Log Level</Text>
            <Text type="secondary">
              Changes take effect immediately; resets to the <code>LOG_LEVEL</code> env var on
              container restart.
            </Text>
            <Space>
              <Select
                value={pendingLogLevel}
                onChange={(v) => setPendingLogLevel(v)}
                style={{ width: 140 }}
                options={[
                  { value: "DEBUG", label: "DEBUG" },
                  { value: "INFO", label: "INFO" },
                  { value: "WARNING", label: "WARNING" },
                  { value: "ERROR", label: "ERROR" },
                  { value: "CRITICAL", label: "CRITICAL" },
                ]}
              />
              <Button
                type="primary"
                loading={setLogLevelMut.isPending}
                onClick={() => {
                  if (pendingLogLevel) setLogLevelMut.mutate(pendingLogLevel);
                }}
              >
                Apply
              </Button>
            </Space>
          </Space>
        </Card>
      )}

      <Modal
        open={credentialModalOpen}
        onCancel={() => {
          setCredentialModalOpen(false);
          setEditingCredential(null);
          credentialForm.resetFields();
        }}
        onOk={() => {
          credentialForm
            .validateFields()
            .then((vals) => {
              if (editingCredential) {
                updateCredentialMut.mutate({ id: editingCredential.id, payload: vals });
                return;
              }
              createCredentialMut.mutate(vals);
            })
            .catch(() => null);
        }}
        confirmLoading={createCredentialMut.isPending || updateCredentialMut.isPending}
        title={editingCredential ? "Edit Credential" : "Add Credential"}
      >
        <Form<CredentialFormValues>
          form={credentialForm}
          layout="vertical"
          initialValues={{ auth_type: "token", verify_tls: true, is_active: true }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="base_url" label="Base URL" rules={[{ required: true }]}>
            <Input placeholder="https://proxmox.example.local:8006" />
          </Form.Item>
          <Form.Item name="auth_type" label="Auth Type" rules={[{ required: true }]}> 
            <Select
              options={[
                { value: "token", label: "Token" },
                { value: "password", label: "Username/Password" },
              ]}
              disabled={!isAdmin}
            />
          </Form.Item>

          {selectedAuthType === "token" && (
            <>
              <Form.Item name="token_id" label="Token ID" rules={[{ required: selectedIsActive }]}>
                <Input placeholder="user@pam!token-name" />
              </Form.Item>
              <Form.Item
                name="token_secret"
                label="Token Secret"
                rules={[{ required: selectedIsActive && !editingCredential, message: "Token secret is required when active" }]}
              >
                <Input.Password placeholder={editingCredential ? "Leave blank to keep existing" : "Secret"} />
              </Form.Item>
            </>
          )}

          {selectedAuthType === "password" && (
            <>
              <Form.Item name="username" label="Username" rules={[{ required: selectedIsActive }]}>
                <Input placeholder="root@pam" />
              </Form.Item>
              <Form.Item
                name="password"
                label="Password"
                rules={[{ required: selectedIsActive && !editingCredential, message: "Password is required when active" }]}
              >
                <Input.Password placeholder={editingCredential ? "Leave blank to keep existing" : "Password"} />
              </Form.Item>
            </>
          )}

          <Form.Item name="verify_tls" label="Verify TLS" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="is_active" label="Active" valuePropName="checked"
            tooltip="Credentials are only required when the credential is active"
          >
            <Switch />
          </Form.Item>
          {!isAdmin && <Text type="secondary">Only admin users can edit credentials.</Text>}
        </Form>
      </Modal>

      <Modal
        open={importModalOpen}
        title="Import Proxmox Credentials"
        onCancel={() => {
          setImportModalOpen(false);
          setImportPreview([]);
        }}
        onOk={() => importCredentialsMut.mutate(importPreview)}
        confirmLoading={importCredentialsMut.isPending}
        okText={`Import ${importPreview.length} credential${importPreview.length === 1 ? "" : "s"}`}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Credentials will be created as <Tag color="default">inactive</Tag> with no auth configured.
          Edit each credential afterwards to add authentication details and activate it.
        </Text>
        <Table
          rowKey="name"
          size="small"
          pagination={false}
          dataSource={importPreview}
          columns={[
            { title: "Name", dataIndex: "name", key: "name" },
            { title: "URL", dataIndex: "base_url", key: "base_url", ellipsis: true },
            {
              title: "Verify TLS",
              dataIndex: "verify_tls",
              key: "verify_tls",
              width: 90,
              render: (v: boolean) => (v ? "Yes" : "No"),
            },
          ]}
        />
      </Modal>

      <Modal
        open={pendingModalOpen}
        onCancel={() => {
          setPendingModalOpen(false);
          setEditingPending(null);
          setSelectedNicKey(null);
          pendingForm.resetFields();
        }}
        onOk={() => {
          pendingForm
            .validateFields()
            .then((vals) => {
              if (editingPending) {
                updatePendingMut.mutate({ id: editingPending.id, payload: vals });
              }
            })
            .catch(() => null);
        }}
        confirmLoading={updatePendingMut.isPending}
        title={`Edit Pending Host — ${editingPending?.name ?? ""} (${editingPending?.vm_type === "node" ? "Node" : `VMID ${editingPending?.vmid ?? ""}`})`}
        width={680}
      >
        {/* Network interface picker */}
        {(() => {
          const ifaces: Array<{ key: string; mac: string | null; bridge: string | null; vlan_tag: number | null; ip: string | null }> =
            editingPending?.nets_json ? JSON.parse(editingPending.nets_json) : [];
          if (ifaces.length === 0) return null;
          const allIpsNull = ifaces.every((iface) => iface.ip == null);
          return (
            <>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>Network Interfaces — click "Use" to populate fields</div>
              {allIpsNull && (
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
                  IPs not available — guest agent may not be running on this VM
                </Typography.Text>
              )}
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                style={{ marginBottom: 16 }}
                onRow={(row) => ({
                  style: row.key === selectedNicKey
                    ? { background: "rgba(99, 71, 255, 0.15)" }
                    : undefined,
                })}
                columns={[
                  { title: "NIC", dataIndex: "key", width: 50 },
                  { title: "Bridge", dataIndex: "bridge", width: 80, render: (v: string | null) => v ?? "—" },
                  { title: "VLAN", dataIndex: "vlan_tag", width: 60, render: (v: number | null) => v != null ? <Tag color="blue">{v}</Tag> : "—" },
                  { title: "MAC", dataIndex: "mac", width: 150, render: (v: string | null) => v ? <code style={{ fontSize: 11 }}>{v}</code> : "—" },
                  { title: "IP", dataIndex: "ip", width: 120, render: (v: string | null) => v ?? "—" },
                  {
                    title: "",
                    width: 50,
                    render: (_: unknown, row: typeof ifaces[number]) => (
                      <Tooltip title="Populate IP / VLAN / MAC from this interface">
                        <Button
                          size="small"
                          type="link"
                          onClick={() => {
                            if (row.ip) pendingForm.setFieldValue("ipv4", row.ip);
                            if (row.mac) pendingForm.setFieldValue("mac", row.mac);
                            if (row.vlan_tag != null) {
                              // find the VLAN FK in the loaded vlans list
                              const match = vlans?.items.find((v) => v.vlan_id === row.vlan_tag);
                              if (match) pendingForm.setFieldValue("vlan_id", match.id);
                            }
                            setSelectedNicKey(row.key);
                          }}
                        >
                          Use
                        </Button>
                      </Tooltip>
                    ),
                  },
                ]}
                dataSource={ifaces}
              />
            </>
          );
        })()}
        <Form<ProxmoxPendingHostUpdate> form={pendingForm} layout="vertical">
          <Form.Item name="environment_id" label="Environment" rules={[{ required: true }]}>
            <Select
              options={buildSortedOptions(environments?.items ?? [], (e) => ({ value: e.id, label: e.name }))}
              placeholder="Select environment"
              allowClear
              showSearch
              filterOption={filterSelectOption}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: "8px 0" }} />
                  <Space style={{ padding: "0 8px 4px" }}>
                    <Input
                      size="small"
                      placeholder="New environment name"
                      value={newEnvName}
                      onChange={(e) => setNewEnvName(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={async () => {
                        if (!newEnvName.trim()) return;
                        const rec = await createRecord<Environment>("/environments", { name: newEnvName.trim() });
                        await qc.invalidateQueries({ queryKey: ["/environments"] });
                        pendingForm.setFieldValue("environment_id", rec.id);
                        setNewEnvName("");
                      }}
                    >
                      Add
                    </Button>
                  </Space>
                </>
              )}
            />
          </Form.Item>
          <Form.Item name="host_type_id" label="Host Type" rules={[{ required: true }]}>
            <Select
              options={buildSortedOptions(hostTypes?.items ?? [], (t) => ({ value: t.id, label: t.name }))}
              placeholder="Select host type"
              allowClear
              showSearch
              filterOption={filterSelectOption}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: "8px 0" }} />
                  <Space style={{ padding: "0 8px 4px" }}>
                    <Input
                      size="small"
                      placeholder="New host type name"
                      value={newHostTypeName}
                      onChange={(e) => setNewHostTypeName(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={async () => {
                        if (!newHostTypeName.trim()) return;
                        const rec = await createRecord<HostType>("/host-types", { name: newHostTypeName.trim() });
                        await qc.invalidateQueries({ queryKey: ["/host-types"] });
                        pendingForm.setFieldValue("host_type_id", rec.id);
                        setNewHostTypeName("");
                      }}
                    >
                      Add
                    </Button>
                  </Space>
                </>
              )}
            />
          </Form.Item>
          <Form.Item name="vlan_id" label="VLAN" rules={[{ required: true }]}>
            <Select
              options={buildSortedOptions(vlans?.items ?? [], buildVlanOption)}
              placeholder="Select VLAN"
              allowClear
              showSearch
              filterOption={filterSelectOption}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: "8px 0" }} />
                  <Space style={{ padding: "0 8px 4px" }}>
                    <InputNumber
                      size="small"
                      placeholder="VLAN ID"
                      value={newVlanId}
                      onChange={(v) => setNewVlanId(v)}
                      min={1}
                      max={4094}
                      style={{ width: 90 }}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={async () => {
                        if (!newVlanId) return;
                        const rec = await createRecord<Vlan>("/vlans", { vlan_id: newVlanId });
                        await qc.invalidateQueries({ queryKey: ["/vlans"] });
                        pendingForm.setFieldValue("vlan_id", rec.id);
                        setNewVlanId(null);
                      }}
                    >
                      Add
                    </Button>
                  </Space>
                </>
              )}
            />
          </Form.Item>
          <Form.Item name="role_id" label="Role" rules={[{ required: true }]}>
            <Select
              options={buildSortedOptions(roles?.items ?? [], (r) => ({ value: r.id, label: r.name }))}
              placeholder="Select role"
              allowClear
              showSearch
              filterOption={filterSelectOption}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: "8px 0" }} />
                  <Space style={{ padding: "0 8px 4px" }}>
                    <Input
                      size="small"
                      placeholder="New role name"
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={async () => {
                        if (!newRoleName.trim()) return;
                        const rec = await createRecord<Role>("/roles", { name: newRoleName.trim() });
                        await qc.invalidateQueries({ queryKey: ["/roles"] });
                        pendingForm.setFieldValue("role_id", rec.id);
                        setNewRoleName("");
                      }}
                    >
                      Add
                    </Button>
                  </Space>
                </>
              )}
            />
          </Form.Item>
          <Form.Item name="ipv4" label="IPv4 Address" rules={[{ required: true }]}>
            <Input placeholder="10.10.x.x or DHCP" />
          </Form.Item>
          <Form.Item name="mac" label="MAC Address">
            <Input placeholder="aa:bb:cc:dd:ee:ff" />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} />
          </Form.Item>
          {editingPending?.vm_type === "node" && (
            <Form.Item
              name="host_id_override"
              label="Host ID"
              extra="Assign a unique numeric ID for this physical PVE node (used as VMID when promoting)."
              rules={[{ required: true, message: "Host ID is required before promoting a node" }]}
            >
              <InputNumber style={{ width: "100%" }} placeholder="e.g. 9001" min={1} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        open={bulkPendingEditOpen}
        onCancel={() => { setBulkPendingEditOpen(false); bulkPendingForm.resetFields(); }}
        onOk={handleBulkPendingEdit}
        confirmLoading={bulkPendingEditLoading}
        title={`Bulk Edit ${selectedPendingIds.length} Pending Host(s)`}
        destroyOnClose
      >
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Only filled fields will be applied to all selected hosts.
        </Typography.Text>
        <Form<ProxmoxPendingHostUpdate> form={bulkPendingForm} layout="vertical">
          <Form.Item name="environment_id" label="Environment">
            <Select
              options={buildSortedOptions(environments?.items ?? [], (e) => ({ value: e.id, label: e.name }))}
              placeholder="Select environment"
              allowClear
              showSearch
              filterOption={filterSelectOption}
            />
          </Form.Item>
          <Form.Item name="host_type_id" label="Host Type">
            <Select
              options={buildSortedOptions(hostTypes?.items ?? [], (t) => ({ value: t.id, label: t.name }))}
              placeholder="Select host type"
              allowClear
              showSearch
              filterOption={filterSelectOption}
            />
          </Form.Item>
          <Form.Item name="vlan_id" label="VLAN">
            <Select
              options={buildSortedOptions(vlans?.items ?? [], buildVlanOption)}
              placeholder="Select VLAN"
              allowClear
              showSearch
              filterOption={filterSelectOption}
            />
          </Form.Item>
          <Form.Item name="role_id" label="Role">
            <Select
              options={buildSortedOptions(roles?.items ?? [], (r) => ({ value: r.id, label: r.name }))}
              placeholder="Select role"
              allowClear
              showSearch
              filterOption={filterSelectOption}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
