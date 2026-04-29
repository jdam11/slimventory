import { Alert, Form, Input, Select, Space, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { listRecords } from "../api/crud";
import type { Environment, Host, HostStatus, InventoryFilters, Role, Vlan } from "../types";
import { buildHostOption, buildSortedOptions, buildVlanOption, filterSelectOption } from "../utils/selectOptions";

interface Props {
  filters: InventoryFilters;
  onChange: (nextFilters: InventoryFilters) => void;
}

function normalizeFilters(filters: InventoryFilters): InventoryFilters {
  return {
    environment_ids: filters.environment_ids?.length ? filters.environment_ids : undefined,
    role_ids: filters.role_ids?.length ? filters.role_ids : undefined,
    status_ids: filters.status_ids?.length ? filters.status_ids : undefined,
    vlan_ids: filters.vlan_ids?.length ? filters.vlan_ids : undefined,
    host_ids: filters.host_ids?.length ? filters.host_ids : undefined,
    pattern: filters.pattern?.trim() ? filters.pattern.trim() : null,
  };
}

export default function InventoryTargetSelector({ filters, onChange }: Props) {
  const { data: environments } = useQuery({
    queryKey: ["/environments", "selector"],
    queryFn: () => listRecords<Environment>("/environments", 0, 200),
  });
  const { data: roles } = useQuery({
    queryKey: ["/roles", "selector"],
    queryFn: () => listRecords<Role>("/roles", 0, 200),
  });
  const { data: statuses } = useQuery({
    queryKey: ["/host-statuses", "selector"],
    queryFn: () => listRecords<HostStatus>("/host-statuses", 0, 200),
  });
  const { data: vlans } = useQuery({
    queryKey: ["/vlans", "selector"],
    queryFn: () => listRecords<Vlan>("/vlans", 0, 200),
  });
  const { data: hosts } = useQuery({
    queryKey: ["/hosts", "selector"],
    queryFn: () => listRecords<Host>("/hosts", 0, 500),
  });

  function patch(partial: Partial<InventoryFilters>) {
    onChange(normalizeFilters({ ...filters, ...partial }));
  }

  const activeCount = [
    filters.environment_ids?.length,
    filters.role_ids?.length,
    filters.status_ids?.length,
    filters.vlan_ids?.length,
    filters.host_ids?.length,
    filters.pattern?.trim() ? 1 : 0,
  ].filter(Boolean).length;

  const environmentOptions = buildSortedOptions(environments?.items ?? [], (item) => ({
    value: item.id,
    label: item.name,
  }));
  const roleOptions = buildSortedOptions(roles?.items ?? [], (item) => ({
    value: item.id,
    label: item.name,
  }));
  const statusOptions = buildSortedOptions(statuses?.items ?? [], (item) => ({
    value: item.id,
    label: item.name,
  }));
  const vlanOptions = buildSortedOptions(vlans?.items ?? [], buildVlanOption);
  const hostOptions = buildSortedOptions(hosts?.items ?? [], buildHostOption);

  return (
    <>
      <Form.Item
        label="Inventory Target"
        extra="Combine filters to narrow the host set. Different filter groups intersect with each other."
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Alert
            type="info"
            showIcon
            message={activeCount > 0 ? `${activeCount} active filter${activeCount === 1 ? "" : "s"}` : "No filters applied"}
            description={activeCount > 0 ? "Only hosts matching every populated filter will be targeted." : "No filters means the template targets all hosts."}
          />

          <Form.Item label="Environment" style={{ marginBottom: 0 }}>
            <Select
              mode="multiple"
              allowClear
              value={filters.environment_ids ?? []}
              onChange={(value) => patch({ environment_ids: value })}
              options={environmentOptions}
              showSearch
              filterOption={filterSelectOption}
              placeholder="Any environment"
            />
          </Form.Item>

          <Form.Item label="Roles" style={{ marginBottom: 0 }}>
            <Select
              mode="multiple"
              allowClear
              value={filters.role_ids ?? []}
              onChange={(value) => patch({ role_ids: value })}
              options={roleOptions}
              showSearch
              filterOption={filterSelectOption}
              placeholder="Any role"
            />
          </Form.Item>

          <Form.Item label="Statuses" style={{ marginBottom: 0 }}>
            <Select
              mode="multiple"
              allowClear
              value={filters.status_ids ?? []}
              onChange={(value) => patch({ status_ids: value })}
              options={statusOptions}
              showSearch
              filterOption={filterSelectOption}
              placeholder="Any status"
            />
          </Form.Item>

          <Form.Item label="VLANs" style={{ marginBottom: 0 }}>
            <Select
              mode="multiple"
              allowClear
              value={filters.vlan_ids ?? []}
              onChange={(value) => patch({ vlan_ids: value })}
              options={vlanOptions}
              showSearch
              filterOption={filterSelectOption}
              placeholder="Any VLAN"
            />
          </Form.Item>

          <Form.Item label="Explicit Hosts" style={{ marginBottom: 0 }}>
            <Select
              mode="multiple"
              allowClear
              value={filters.host_ids ?? []}
              onChange={(value) => patch({ host_ids: value })}
              options={hostOptions}
              showSearch
              filterOption={filterSelectOption}
              placeholder="Any host"
            />
          </Form.Item>

          <Form.Item label="Pattern" help="Wildcard match on host name or IPv4, e.g. web* or 10.10.3.*" style={{ marginBottom: 0 }}>
            <Input
              value={filters.pattern ?? ""}
              onChange={(e) => patch({ pattern: e.target.value })}
              placeholder="Optional pattern"
            />
          </Form.Item>

          <Typography.Text type="secondary">
            Example: environment + status + role gives you only hosts matching all three.
          </Typography.Text>
        </Space>
      </Form.Item>
    </>
  );
}
