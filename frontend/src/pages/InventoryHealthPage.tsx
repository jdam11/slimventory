import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Collapse, Empty, List, Space, Spin, Statistic, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import { getInventoryHealth } from "../api/inventory_health";
import type { HealthFinding } from "../types";

const { Title, Text } = Typography;

const CATEGORY_LABELS: Record<string, string> = {
  host_no_role: "Hosts without a role",
  host_stale_proxmox: "Stale Proxmox sync",
  host_stale_unifi: "Stale UniFi observation",
  duplicate_ip: "Duplicate IP addresses",
  app_no_deployment: "Apps not deployed",
  vlan_no_hosts: "VLANs without hosts",
  role_unused: "Unused roles",
};

function FindingItem({ finding }: { finding: HealthFinding }) {
  return (
    <List.Item>
      <Space>
        <Tag color={finding.severity === "warn" ? "orange" : "blue"}>{finding.severity}</Tag>
        {finding.link ? <Link to={finding.link}>{finding.message}</Link> : <Text>{finding.message}</Text>}
      </Space>
    </List.Item>
  );
}

export default function InventoryHealthPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/inventory-health"],
    queryFn: getInventoryHealth,
  });

  const byCategory = (data?.findings ?? []).reduce<Record<string, HealthFinding[]>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  return (
    <Card>
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>
            Inventory Health
          </Title>
          <Text type="secondary">Data-quality checks across hosts, apps, VLANs, and roles.</Text>
        </div>

        {error && <Alert type="error" showIcon message="Failed to load health report" />}

        {isLoading ? (
          <Spin />
        ) : !data ? null : data.total === 0 ? (
          <Empty description="All clear — no issues found" />
        ) : (
          <>
            <Space size="large">
              <Statistic title="Warnings" value={data.counts.warn} valueStyle={{ color: "#fa8c16" }} />
              <Statistic title="Info" value={data.counts.info} valueStyle={{ color: "#1677ff" }} />
            </Space>
            <Collapse
              defaultActiveKey={Object.keys(byCategory)}
              items={Object.entries(byCategory).map(([cat, findings]) => ({
                key: cat,
                label: (
                  <Space>
                    {CATEGORY_LABELS[cat] ?? cat}
                    <Tag>{findings.length}</Tag>
                  </Space>
                ),
                children: (
                  <List
                    size="small"
                    dataSource={findings}
                    renderItem={(f) => <FindingItem finding={f} />}
                  />
                ),
              }))}
            />
          </>
        )}
      </Space>
    </Card>
  );
}
