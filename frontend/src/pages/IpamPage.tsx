import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Card,
  Descriptions,
  Empty,
  Progress,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { getIpamDetail, getIpamSummary } from "../api/ipam";
import type { IpamVlanSummary } from "../types";

const { Title, Text } = Typography;

function utilizationStatus(pct: number): "success" | "normal" | "exception" {
  if (pct >= 90) return "exception";
  if (pct >= 75) return "normal";
  return "success";
}

function IpamDetail({ vlanPk }: { vlanPk: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/ipam", vlanPk],
    queryFn: () => getIpamDetail(vlanPk),
  });

  if (isLoading || !data) return <Spin />;
  if (!data.scoped) {
    return <Alert type="info" showIcon message="This VLAN has no subnet configured, so no allocation can be computed." />;
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }} bordered>
        <Descriptions.Item label="Subnet">{data.subnet}</Descriptions.Item>
        <Descriptions.Item label="Allocated">
          {data.allocated_count} / {data.total_usable}
        </Descriptions.Item>
        <Descriptions.Item label="Free">{data.free_count}</Descriptions.Item>
        <Descriptions.Item label="Next free IP">
          {data.next_free_ip ? <Tag color="green">{data.next_free_ip}</Tag> : <Text type="secondary">none</Text>}
        </Descriptions.Item>
      </Descriptions>

      {data.conflicts.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={`${data.conflicts.length} duplicate IP${data.conflicts.length > 1 ? "s" : ""}`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.conflicts.map((c) => (
                <li key={c.ip}>
                  <Text code>{c.ip}</Text> — {c.hosts.map((h) => `${h.host_name} (#${h.host_id})`).join(", ")}
                </li>
              ))}
            </ul>
          }
        />
      )}

      {data.out_of_subnet.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Hosts with an IP outside this subnet"
          description={data.out_of_subnet.map((h) => `${h.host_name} (${h.ip})`).join(", ")}
        />
      )}

      {data.drift.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="UniFi observed IP differs from inventory"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.drift.map((d) => (
                <li key={d.host_id}>
                  {d.host_name}: inventory <Text code>{d.inventory_ip}</Text> vs observed{" "}
                  <Text code>{d.observed_ip}</Text>
                </li>
              ))}
            </ul>
          }
        />
      )}

      <Table
        size="small"
        rowKey={(r) => `${r.ip}-${r.host_id}`}
        dataSource={data.used}
        pagination={false}
        columns={[
          { title: "IP", dataIndex: "ip" },
          { title: "Host", dataIndex: "host_name" },
          { title: "VMID", dataIndex: "host_id" },
        ]}
        locale={{ emptyText: "No in-subnet allocations" }}
      />
      {data.unparsed.length > 0 && (
        <Text type="secondary">
          Not an IPv4 address (e.g. DHCP): {data.unparsed.map((u) => `${u.host_name} (${u.value ?? "—"})`).join(", ")}
        </Text>
      )}
    </Space>
  );
}

export default function IpamPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/ipam"],
    queryFn: getIpamSummary,
  });

  const columns: ColumnsType<IpamVlanSummary> = [
    { title: "VLAN", dataIndex: "vlan_id", width: 90, sorter: (a, b) => a.vlan_id - b.vlan_id },
    { title: "Subnet", dataIndex: "subnet", render: (s: string | null) => s ?? <Text type="secondary">unscoped</Text> },
    { title: "Description", dataIndex: "description", render: (d: string | null) => d ?? "—" },
    { title: "Hosts", dataIndex: "host_count", width: 80 },
    {
      title: "Utilization",
      key: "utilization",
      width: 240,
      render: (_v, r) =>
        r.scoped ? (
          <Space>
            <Progress
              percent={r.utilization_pct}
              size="small"
              style={{ width: 120 }}
              status={utilizationStatus(r.utilization_pct)}
            />
            <Text type="secondary">
              {r.allocated_count}/{r.total_usable} ({r.free_count} free)
            </Text>
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "Conflicts",
      dataIndex: "conflict_count",
      width: 100,
      render: (c: number) => (c > 0 ? <Tag color="red">{c}</Tag> : <Tag color="green">0</Tag>),
    },
  ];

  return (
    <Card>
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>
            IP Address Management
          </Title>
          <Text type="secondary">Per-VLAN IP allocation, conflicts, and next-free address. Expand a row for detail.</Text>
        </div>
        {error && <Alert type="error" showIcon message="Failed to load IPAM data" />}
        {isLoading ? (
          <Spin />
        ) : !data || data.items.length === 0 ? (
          <Empty description="No VLANs defined" />
        ) : (
          <Table
            rowKey="vlan_pk"
            dataSource={data.items}
            columns={columns}
            pagination={false}
            expandable={{
              expandedRowRender: (r) => <IpamDetail vlanPk={r.vlan_pk} />,
              rowExpandable: (r) => r.scoped,
            }}
          />
        )}
      </Space>
    </Card>
  );
}
