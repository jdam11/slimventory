import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Modal, Popconfirm, Select, Space, Tag, Tooltip, Typography, message } from "antd";
import { DeleteOutlined, UndoOutlined } from "@ant-design/icons";
import { clearAnsibleKnownHostsForHost } from "../../api/admin";
import CrudPage, { type FormField, type SelectOption } from "../../components/CrudPage";
import { listRecords } from "../../api/crud";
import api from "../../api/client";
import { useAuth } from "../../store/AuthContext";
import { useState } from "react";
import { buildHostOption, buildSortedOptions, buildVlanOption, filterSelectOption } from "../../utils/selectOptions";
import type {
  Host,
  Environment,
  HostType,
  HostStatus,
  Vlan,
  Role,
  K3sCluster,
  Domain,
} from "../../types";

export default function HostsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const [selectedHostIds, setSelectedHostIds] = useState<number[]>([]);
  const [bulkRoleOpen, setBulkRoleOpen] = useState(false);
  const [bulkRoleForm] = Form.useForm<{ role_ids: number[] }>();
  const { data: envData } = useQuery({ queryKey: ["/environments"], queryFn: () => listRecords<Environment>("/environments", 0, 500) });
  const { data: htData } = useQuery({ queryKey: ["/host-types"], queryFn: () => listRecords<HostType>("/host-types", 0, 500) });
  const { data: statusData } = useQuery({ queryKey: ["/host-statuses"], queryFn: () => listRecords<HostStatus>("/host-statuses", 0, 500) });
  const { data: vlanData } = useQuery({ queryKey: ["/vlans"], queryFn: () => listRecords<Vlan>("/vlans", 0, 500) });
  const { data: roleData } = useQuery({ queryKey: ["/roles"], queryFn: () => listRecords<Role>("/roles", 0, 500) });
  const { data: clusterData } = useQuery({ queryKey: ["/k3s-clusters"], queryFn: () => listRecords<K3sCluster>("/k3s-clusters", 0, 500) });
  const { data: hostData } = useQuery({ queryKey: ["/hosts"], queryFn: () => listRecords<Host>("/hosts", 0, 500) });
  const { data: domainData } = useQuery({ queryKey: ["/domains"], queryFn: () => listRecords<Domain>("/domains", 0, 500) });

  const envOpts = buildSortedOptions(envData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const htOpts = buildSortedOptions(htData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const statusOpts = buildSortedOptions(statusData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const vlanOpts = buildSortedOptions(vlanData?.items ?? [], buildVlanOption);
  const roleOpts = buildSortedOptions(roleData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const clusterOpts = buildSortedOptions(clusterData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const hostOpts = buildSortedOptions(hostData?.items ?? [], buildHostOption);
  const domainOpts = buildSortedOptions(domainData?.items ?? [], (e) => ({ value: e.id, label: e.fqdn }));

  const name = (opts: SelectOption[], v: number) =>
    opts.find((o) => o.value === v)?.label ?? v;

  const COLUMNS = [
    { title: "VMID", dataIndex: "id", key: "id", width: 80 },
    { title: "Name", dataIndex: "name", key: "name", width: 160 },
    { title: "IP", dataIndex: "ipv4", key: "ipv4", width: 130 },
    {
      title: "Effective IP",
      dataIndex: "effective_ipv4",
      key: "effective_ipv4",
      width: 140,
      render: (value: string | null, row: Host) => value ?? row.ipv4 ?? "-",
    },
    { title: "Type", dataIndex: "host_type_id", key: "ht", width: 90, render: (v: number) => name(htOpts, v) },
    { title: "Env", dataIndex: "environment_id", key: "env", width: 90, render: (v: number) => name(envOpts, v) },
    { title: "VLAN", dataIndex: "vlan_id", key: "vlan", width: 100, render: (v: number) => name(vlanOpts, v) },
    {
      title: "UniFi Network",
      dataIndex: "unifi_network_name",
      key: "unifi_network_name",
      width: 150,
      render: (value: string | null, row: Host) =>
        value ? `${value}${row.unifi_vlan_tag ? ` (VLAN ${row.unifi_vlan_tag})` : ""}` : "-",
    },
    {
      title: "Roles",
      dataIndex: "role_ids",
      key: "roles",
      width: 200,
      render: (ids: number[]) =>
        (ids ?? []).map((id) => {
          const label = roleOpts.find((o) => o.value === id)?.label;
          return label ? (
            <Tag key={id} color="blue">
              {label}
            </Tag>
          ) : null;
        }),
    },
    { title: "Status", dataIndex: "status_id", key: "status", width: 120, render: (v: number | null) => v ? name(statusOpts, v) : "-" },
    { title: "MAC", dataIndex: "mac", key: "mac", width: 140 },
    {
      title: "Port Forwards",
      dataIndex: "unifi_port_forward_count",
      key: "unifi_port_forward_count",
      width: 140,
      render: (_value: number, row: Host) => {
        if (!row.unifi_port_forwards?.length) {
          return "-";
        }
        return (
          <Tooltip
            title={row.unifi_port_forwards
              .map((portForward) => {
                const name = portForward.rule_name ?? "Rule";
                const ports = `${portForward.protocol ?? "?"} ${portForward.external_port ?? "?"}->${portForward.internal_port ?? "?"}`;
                return `${name}: ${ports}`;
              })
              .join("\n")}
          >
            <Tag color="cyan">{row.unifi_port_forward_count}</Tag>
          </Tooltip>
        );
      },
    },
    { title: "PVE Node", dataIndex: "proxmox_node", key: "proxmox_node", width: 110, render: (v: string | null) => v ?? "-" },
    { title: "Cluster", dataIndex: "k3s_cluster_id", key: "cluster", width: 130, render: (v: number) => v ? name(clusterOpts, v) : "-" },
    { title: "Notes", dataIndex: "notes", key: "notes", width: 200 },
    {
      title: "UniFi Last Seen",
      dataIndex: "unifi_last_seen_at",
      key: "unifi_last_seen_at",
      width: 170,
      render: (value: string | null) => value ? new Date(value).toLocaleString() : "-",
    },
    {
      title: "Last Synced",
      dataIndex: "last_synced_at",
      key: "last_synced_at",
      width: 160,
      render: (v: string | null) => v ? new Date(v).toLocaleString() : "-",
    },
  ];

  const FIELDS: FormField[] = [
    {
      key: "id",
      label: "VMID (Proxmox ID)",
      type: "number" as const,
      required: true,
      min: 1,
      section: "Identity",
      helperText: "Inventory and Proxmox ID for this host.",
    },
    { key: "name", label: "Name", type: "text" as const, required: true, section: "Identity" },
    {
      key: "ipv4",
      label: "IPv4",
      type: "text" as const,
      required: true,
      placeholder: "10.10.x.x or DHCP",
      section: "Identity",
      helperText: "Use a static address or the DHCP label you track operationally.",
    },
    { key: "mac", label: "MAC Address", type: "text" as const, section: "Identity" },
    {
      key: "environment_id",
      label: "Environment",
      type: "select" as const,
      required: true,
      options: envOpts,
      section: "Placement",
      quickCreate: {
        endpoint: "/environments",
        queryKey: "/environments",
        title: "Create Environment",
        fields: [{ key: "name", label: "Name", type: "text" as const, required: true }],
      },
    },
    {
      key: "host_type_id",
      label: "Host Type",
      type: "select" as const,
      required: true,
      options: htOpts,
      section: "Placement",
      quickCreate: {
        endpoint: "/host-types",
        queryKey: "/host-types",
        title: "Create Host Type",
        fields: [{ key: "name", label: "Name", type: "text" as const, required: true }],
      },
    },
    {
      key: "vlan_id",
      label: "VLAN",
      type: "select" as const,
      required: true,
      options: vlanOpts,
      section: "Placement",
      quickCreate: {
        endpoint: "/vlans",
        queryKey: "/vlans",
        title: "Create VLAN",
        fields: [
          { key: "vlan_id", label: "VLAN ID", type: "number" as const, required: true, min: 1 },
          { key: "subnet", label: "Subnet", type: "text" as const },
          { key: "description", label: "Description", type: "text" as const },
        ],
      },
    },
    {
      key: "role_ids",
      label: "Roles (ordered by priority, first = highest)",
      type: "multiselect" as const,
      required: true,
      options: roleOpts,
      section: "Placement",
      helperText: "Role order controls precedence when vars overlap.",
    },
    {
      key: "status_id",
      label: "Status",
      type: "select" as const,
      options: statusOpts,
      section: "Placement",
      quickCreate: {
        endpoint: "/host-statuses",
        queryKey: "/host-statuses",
        title: "Create Status",
        fields: [{ key: "name", label: "Name", type: "text" as const, required: true }],
      },
    },
    {
      key: "k3s_cluster_id",
      label: "K3s Cluster",
      type: "select" as const,
      options: clusterOpts,
      section: "Placement",
      quickCreate: {
        endpoint: "/k3s-clusters",
        queryKey: "/k3s-clusters",
        title: "Create K3s Cluster",
        fields: [
          { key: "name", label: "Name", type: "text" as const, required: true },
          { key: "environment_id", label: "Environment", type: "select" as const, required: true, options: envOpts },
        ],
        initialValues: (parent: Record<string, unknown>) => ({ environment_id: parent.environment_id }),
      },
    },
    {
      key: "proxmox_host_id",
      label: "Proxmox Host",
      type: "select" as const,
      options: hostOpts,
      section: "Routing & Platform",
    },
    {
      key: "proxmox_node",
      label: "PVE Node Name",
      type: "text" as const,
      section: "Routing & Platform",
    },
    {
      key: "domain_internal_id",
      label: "Domain Internal",
      type: "select" as const,
      options: domainOpts,
      section: "Routing & Platform",
      quickCreate: {
        endpoint: "/domains",
        queryKey: "/domains",
        title: "Create Domain",
        fields: [{ key: "fqdn", label: "FQDN", type: "text" as const, required: true }],
      },
    },
    {
      key: "domain_external_id",
      label: "Domain External",
      type: "select" as const,
      options: domainOpts,
      section: "Routing & Platform",
      quickCreate: {
        endpoint: "/domains",
        queryKey: "/domains",
        title: "Create Domain",
        fields: [{ key: "fqdn", label: "FQDN", type: "text" as const, required: true }],
      },
    },
    {
      key: "notes",
      label: "Notes",
      type: "textarea" as const,
      section: "Notes",
      helperText: "Operational context, exceptions, or handoff details.",
    },
  ];

  const recycleMut = useMutation({
    mutationFn: (id: number) => api.post(`/hosts/${id}/recycle`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/hosts"] });
      message.success("Host recycled — will reappear in Proxmox pending on next sync");
    },
    onError: (e: unknown) =>
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Recycle failed"
      ),
  });

  const bulkAddRolesMut = useMutation({
    mutationFn: (roleIds: number[]) =>
      api.post("/hosts/bulk-add-roles", {
        host_ids: selectedHostIds,
        role_ids: roleIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/hosts"] });
      bulkRoleForm.resetFields();
      setBulkRoleOpen(false);
      message.success(`Added roles to ${selectedHostIds.length} host(s)`);
    },
    onError: (e: unknown) =>
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to add roles"
      ),
  });

  const clearKnownHostsMut = useMutation({
    mutationFn: (id: number) => clearAnsibleKnownHostsForHost(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["/admin/ssh-known-hosts"] });
      message.success(
        result.aliases.length
          ? `Cleared SSH cache for ${result.aliases.join(", ")}`
          : "SSH cache entry cleared"
      );
    },
    onError: (e: unknown) =>
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to clear SSH cache"
      ),
  });

  function openBulkRoleModal() {
    bulkRoleForm.resetFields();
    setBulkRoleOpen(true);
  }

  async function submitBulkRoles() {
    try {
      const values = await bulkRoleForm.validateFields();
      if (!values.role_ids?.length) {
        message.warning("Select at least one role");
        return;
      }
      bulkAddRolesMut.mutate(values.role_ids);
    } catch {
      return;
    }
  }

  function cloneHostDraft(record: Host): Record<string, unknown> {
    return {
      id: undefined,
      name: `${record.name}-copy`,
      ipv4: undefined,
      mac: undefined,
      environment_id: record.environment_id,
      host_type_id: record.host_type_id,
      vlan_id: record.vlan_id,
      role_ids: record.role_ids,
      status_id: record.status_id,
      k3s_cluster_id: record.k3s_cluster_id,
      proxmox_host_id: undefined,
      proxmox_node: undefined,
      domain_internal_id: record.domain_internal_id,
      domain_external_id: record.domain_external_id,
      notes: record.notes,
    };
  }

  return (
    <>
      <CrudPage<Host>
        title="Hosts"
        endpoint="/hosts"
        columns={COLUMNS}
        formFields={FIELDS}
        cloneRecord={cloneHostDraft}
        cloneActionLabel="Clone host"
        openEditOnDoubleClick
        preserveSelectionOnBulkEdit
        onSelectionChange={(keys) => setSelectedHostIds(keys.map((key) => Number(key)).filter((key) => Number.isFinite(key)))}
        extraHeaderButtons={
          isAdmin && selectedHostIds.length > 0 ? (
            <Button onClick={openBulkRoleModal}>
              Add Roles ({selectedHostIds.length})
            </Button>
          ) : null
        }
        extraActions={(record) =>
          isAdmin ? (
            <Space>
              <Popconfirm
                title="Clear SSH host key cache?"
                description="Use this after a host redeploy or SSH host key rotation."
                okText="Clear"
                cancelText="Cancel"
                onConfirm={() => clearKnownHostsMut.mutate(record.id)}
              >
                <Tooltip title="Clear SSH cache">
                  <Button size="small" icon={<DeleteOutlined />} loading={clearKnownHostsMut.isPending} />
                </Tooltip>
              </Popconfirm>
              <Popconfirm
                title="Recycle this host?"
                description="Deletes the host and sends it back to Proxmox pending for re-setup."
                okText="Recycle"
                cancelText="Cancel"
                onConfirm={() => recycleMut.mutate(record.id)}
              >
                <Tooltip title="Recycle to pending">
                  <Button size="small" icon={<UndoOutlined />} loading={recycleMut.isPending} />
                </Tooltip>
              </Popconfirm>
            </Space>
          ) : null
        }
      />

      <Modal
        title={`Add Roles To ${selectedHostIds.length} Host(s)`}
        open={bulkRoleOpen}
        onCancel={() => {
          setBulkRoleOpen(false);
          bulkRoleForm.resetFields();
        }}
        onOk={submitBulkRoles}
        confirmLoading={bulkAddRolesMut.isPending}
        okText="Add Roles"
        width={680}
        destroyOnClose
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            Selected roles are appended to each selected host. Existing roles stay in place and duplicates are ignored.
          </Typography.Text>
          <Form form={bulkRoleForm} layout="vertical">
            <Form.Item
              name="role_ids"
              label="Roles To Add"
              rules={[{ required: true, message: "Select at least one role" }]}
            >
              <Select
                mode="multiple"
                options={roleOpts}
                showSearch
                filterOption={filterSelectOption}
                placeholder="Select roles to append"
              />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </>
  );
}
