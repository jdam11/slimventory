import {
  Alert,
  Button,
  Card,
  Col,
  List,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import {
  AppstoreOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  LineChartOutlined,
  PlayCircleOutlined,
  RocketOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { listRecords } from "../api/crud";
import { listGitRepos, listPlaybookRuns } from "../api/git";
import { listJobTemplates, listVaultCredentials } from "../api/job_templates";
import { getMonitoringAlerts, getMonitoringOverview } from "../api/monitoring";
import { listProxmoxPendingHosts, listProxmoxSyncRuns } from "../api/proxmox";
import { useAuth } from "../store/AuthContext";
import SetupWizardModal, { isWizardComplete } from "../components/SetupWizardModal";
import type { App, Environment, Host, InventoryRow, PlaybookRun } from "../types";

const { Title, Text } = Typography;

const STALE_HOURS = 48;

function isStale(lastSynced: string | null): boolean {
  if (!lastSynced) return false;
  const diff = Date.now() - new Date(lastSynced).getTime();
  return diff > STALE_HOURS * 60 * 60 * 1000;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function statusColor(status: string): string {
  if (status === "success" || status === "completed") return "green";
  if (status === "running" || status === "pending") return "blue";
  if (status === "failed") return "red";
  if (status === "cancelled") return "orange";
  return "default";
}

function average(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value != null && !Number.isNaN(value));
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

export default function HomeDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data: envCheckData } = useQuery({
    queryKey: ["/environments", "wizard-autoshow"],
    queryFn: () => listRecords<Environment>("/environments", 0, 1),
    enabled: isAdmin,
  });

  useEffect(() => {
    if (!isAdmin) return;
    if (isWizardComplete()) return;
    if (envCheckData !== undefined && envCheckData.total === 0) {
      setWizardOpen(true);
    }
  }, [isAdmin, envCheckData]);

  const { data: inventoryData, isLoading: inventoryLoading } = useQuery({
    queryKey: ["/inventory", "dashboard"],
    queryFn: () => listRecords<InventoryRow>("/inventory", 0, 500),
  });
  const { data: hostsData } = useQuery({
    queryKey: ["/hosts", "dashboard"],
    queryFn: () => listRecords<Host>("/hosts", 0, 500),
  });
  const { data: appsData } = useQuery({
    queryKey: ["/apps", "dashboard"],
    queryFn: () => listRecords<App>("/apps", 0, 500),
  });
  const { data: templatesData } = useQuery({
    queryKey: ["/job-templates", "dashboard"],
    queryFn: () => listJobTemplates(0, 200),
  });
  const { data: runsData } = useQuery({
    queryKey: ["/playbook-runs", "dashboard"],
    queryFn: () => listPlaybookRuns({ limit: 8 }),
    refetchInterval: 5000,
  });
  const { data: reposData } = useQuery({
    queryKey: ["/git-repos", "dashboard"],
    queryFn: () => listGitRepos(0, 200),
  });
  const { data: vaultData } = useQuery({
    queryKey: ["/vault-credentials", "dashboard"],
    queryFn: () => listVaultCredentials(0, 200),
    enabled: isAdmin,
  });
  const { data: proxmoxRunsData } = useQuery({
    queryKey: ["/proxmox/runs", "dashboard"],
    queryFn: () => listProxmoxSyncRuns(0, 5),
  });
  const { data: pendingData } = useQuery({
    queryKey: ["/proxmox/pending", "dashboard"],
    queryFn: () => listProxmoxPendingHosts(0, 100),
    enabled: isAdmin,
  });
  const { data: monitoringData } = useQuery({
    queryKey: ["/monitoring/overview", "dashboard"],
    queryFn: () => getMonitoringOverview(),
    refetchInterval: 30_000,
  });
  const { data: monitoringAlertsData } = useQuery({
    queryKey: ["/monitoring/alerts", "dashboard"],
    queryFn: () => getMonitoringAlerts(),
    refetchInterval: 30_000,
  });

  const inventoryRows = inventoryData?.items ?? [];
  const hostCount = hostsData?.total ?? inventoryRows.length;
  const staleCount = inventoryRows.filter((row) => isStale(row.last_synced_at)).length;
  const templates = templatesData?.items ?? [];
  const activeRuns = (runsData?.items ?? []).filter((run) => run.status === "running" || run.status === "pending").length;
  const repoCount = reposData?.items?.length ?? 0;
  const ansibleRepoCount = (reposData?.items ?? []).filter((repo) => repo.repo_type === "ansible").length;
  const appRepoCount = (reposData?.items ?? []).filter((repo) => repo.repo_type === "app").length;
  const activeSchedules = templates.filter((template) => template.inventory_filter_type !== undefined).length;
  const latestSync = proxmoxRunsData?.items?.[0];
  const monitoringAlerts = monitoringAlertsData?.items.length ?? 0;
  const hostsAtRisk = (monitoringData?.hosts ?? []).filter((host) => host.health_score < 70).length;
  const monitoredHosts = monitoringData?.hosts.length ?? 0;
  const hostsDown = (monitoringData?.hosts ?? []).filter((host) => !host.up).length;
  const cpuAverage = average((monitoringData?.hosts ?? []).map((host) => host.cpu_usage_percent));
  const memoryAverage = average((monitoringData?.hosts ?? []).map((host) => host.memory_usage_percent));
  const totalLogLines = (monitoringData?.log_volume ?? []).reduce((sum, item) => sum + item.lines_last_hour, 0);
  const monitoringConfigured = Boolean(monitoringData?.prometheus.configured || monitoringData?.loki.configured);
  const monitoringSummary = !monitoringData
    ? "Monitoring summary unavailable."
    : !monitoringConfigured
      ? "Prometheus and Loki are not configured."
      : [
          monitoringData.prometheus.configured ? `Prometheus: ${monitoringData.prometheus.reachable ? "online" : "offline"}` : "Prometheus: disabled",
          monitoringData.loki.configured ? `Loki: ${monitoringData.loki.reachable ? "online" : "offline"}` : "Loki: disabled",
        ].join(" · ");

  return (
    <>
    <div>
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <img src="/logo.svg" alt="SLIM logo" style={{ height: 44, width: "auto", display: "block", marginBottom: 6 }} />
            <Text type="secondary">Operational overview for inventory, automation, and infrastructure activity.</Text>
          </div>
          <Space wrap>
            {isAdmin && (
              <Button icon={<RocketOutlined />} onClick={() => setWizardOpen(true)}>
                Setup Guide
              </Button>
            )}
            <Button onClick={() => navigate("/inventory/overview")}>Inventory Overview</Button>
            <Button onClick={() => navigate("/monitoring")}>Monitoring</Button>
            <Button onClick={() => navigate("/monitoring/alerts")}>Alert Center</Button>
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => navigate("/automation/job-templates")}>
              Job Templates
            </Button>
          </Space>
        </div>
        <div>
          <Title level={3} style={{ margin: 0 }}>Dashboard</Title>
          <Text type="secondary">Current lab health, automation activity, and monitoring signals at a glance.</Text>
        </div>

        {staleCount > 0 && (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message={`${staleCount} host${staleCount === 1 ? "" : "s"} have stale sync data.`}
            action={<Button size="small" onClick={() => navigate("/inventory/overview")}>Review Inventory</Button>}
          />
        )}

        {!monitoringConfigured && (
          <Alert
            type="info"
            showIcon
            message="Monitoring is optional and currently disabled."
            description="Configure Prometheus and/or Loki to populate host health and log activity cards."
            action={<Button size="small" onClick={() => navigate("/monitoring")}>Open Monitoring</Button>}
          />
        )}

        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card loading={inventoryLoading}>
              <Statistic title="Hosts" value={hostCount} prefix={<DatabaseOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Stale Hosts" value={staleCount} prefix={<WarningOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Apps" value={appsData?.total ?? 0} prefix={<AppstoreOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Job Templates" value={templates.length} prefix={<FolderOpenOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Active Runs" value={activeRuns} prefix={<ThunderboltOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Vault Credentials" value={vaultData?.total ?? 0} prefix={<SafetyOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Monitoring Alerts" value={monitoringAlerts} prefix={<LineChartOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Hosts At Risk" value={hostsAtRisk} prefix={<WarningOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Monitored Hosts" value={monitoredHosts} prefix={<DatabaseOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Hosts Down" value={hostsDown} prefix={<WarningOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Avg CPU" value={cpuAverage == null ? "—" : `${cpuAverage.toFixed(1)}%`} prefix={<LineChartOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Avg Memory" value={memoryAverage == null ? "—" : `${memoryAverage.toFixed(1)}%`} prefix={<LineChartOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8} xl={4}>
            <Card>
              <Statistic title="Logs / Hour" value={totalLogLines.toLocaleString()} prefix={<LineChartOutlined />} />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={14}>
            <Card
              title="Recent Automation Activity"
              extra={<Button type="link" onClick={() => navigate("/automation/playbook-runs")}>Open Automation Runs</Button>}
            >
              <List
                dataSource={runsData?.items ?? []}
                locale={{ emptyText: "No runs yet." }}
                renderItem={(run: PlaybookRun) => (
                  <List.Item>
                    <Space direction="vertical" size={2} style={{ width: "100%" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <Text strong>Run #{run.id}</Text>
                        <Tag color={statusColor(run.status)}>{run.status}</Tag>
                      </div>
                      <Text type="secondary">
                        Playbook #{run.playbook_id} · {formatDate(run.created_at)}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            <Card title="Automation Snapshot">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text>Git repos</Text>
                  <Text strong>{repoCount}</Text>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text type="secondary">Ansible repos</Text>
                  <Text>{ansibleRepoCount}</Text>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text type="secondary">App repos</Text>
                  <Text>{appRepoCount}</Text>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text>Templates</Text>
                  <Text strong>{templates.length}</Text>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text>Tracked schedules</Text>
                  <Text>{activeSchedules}</Text>
                </div>
                {isAdmin && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <Text>Pending Proxmox items</Text>
                    <Text>{pendingData?.total ?? 0}</Text>
                  </div>
                )}
              </Space>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title="Infrastructure Health">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text>Latest Proxmox sync</Text>
                  <Tag color={statusColor(latestSync?.status ?? "default")}>{latestSync?.status ?? "none"}</Tag>
                </div>
                <Text type="secondary">
                  {latestSync
                    ? `${formatDate(latestSync.started_at)}${latestSync.message ? ` · ${latestSync.message}` : ""}`
                    : "No Proxmox syncs recorded."}
                </Text>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text>Recent sync events</Text>
                  <Text>{proxmoxRunsData?.items?.length ?? 0}</Text>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text>Prometheus targets down</Text>
                  <Text>{monitoringData?.prometheus.configured ? (monitoringData.targets.unhealthy_targets ?? 0) : "disabled"}</Text>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text>Loki services with logs</Text>
                  <Text>{monitoringData?.loki.configured ? (monitoringData.log_volume.length ?? 0) : "disabled"}</Text>
                </div>
                <Text type="secondary">{monitoringSummary}</Text>
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="Quick Actions">
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Button block onClick={() => navigate("/inventory/hosts")}>Open Hosts</Button>
                <Button block onClick={() => navigate("/inventory/overview")}>Open Inventory Overview</Button>
                <Button block onClick={() => navigate("/monitoring")}>Open Monitoring</Button>
                <Button block onClick={() => navigate("/monitoring/alerts")}>Open Alert Center</Button>
                <Button block onClick={() => navigate("/monitoring/capacity")}>Open Capacity</Button>
                <Button block onClick={() => navigate("/monitoring/hosts")}>Open Host Health</Button>
                <Button block onClick={() => navigate("/monitoring/services")}>Open Service Activity</Button>
                <Button block onClick={() => navigate("/monitoring/logs")}>Open Log Explorer</Button>
                <Button block onClick={() => navigate("/automation/git-repos")}>Open Git Repos</Button>
                <Button block onClick={() => navigate("/automation/job-templates")}>Open Job Templates</Button>
                <Button block onClick={() => navigate("/automation/playbook-runs")}>Open Automation Runs</Button>
              </Space>
            </Card>
          </Col>
        </Row>
      </Space>
    </div>
    {isAdmin && (
      <SetupWizardModal open={wizardOpen} onClose={() => setWizardOpen(false)} />
    )}
    </>
  );
}
