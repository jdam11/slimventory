import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Input,
  List,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import {
  CloudServerOutlined,
  DatabaseOutlined,
  LineChartOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { listRecords } from "../api/crud";
import { launchJobTemplate } from "../api/job_templates";
import { getMonitoringAlerts, getMonitoringHistory, getMonitoringLogs, getMonitoringOverview } from "../api/monitoring";
import PrometheusHistorySection from "../components/PrometheusHistorySection";
import { useAuth } from "../store/AuthContext";
import type { Host, MonitoringAlert, MonitoringHostStatus, MonitoringLogEntry, MonitoringOverview } from "../types";

const { Title, Text, Paragraph } = Typography;

type MonitoringView = "overview" | "alerts" | "capacity" | "hosts" | "services" | "logs";

interface MonitoringPageProps {
  initialView?: MonitoringView;
}

function statusColor(ok: boolean): string {
  return ok ? "green" : "red";
}

function readinessTag(ready: boolean | null): { color: string; label: string } {
  if (ready === true) return { color: "green", label: "ready" };
  if (ready === false) return { color: "orange", label: "not ready" };
  return { color: "default", label: "unknown" };
}

function percent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function average(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value != null && !Number.isNaN(value));
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function viewPath(view: MonitoringView): string {
  if (view === "overview") return "/monitoring";
  return `/monitoring/${view}`;
}

function severityColor(severity: string): string {
  if (severity === "critical") return "red";
  if (severity === "high") return "orange";
  if (severity === "medium") return "gold";
  return "blue";
}

const LOG_NOISE_PATTERNS = [
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

function logIsNoise(entry: MonitoringLogEntry): boolean {
  const haystack = `${entry.service_name ?? ""} ${entry.level ?? ""} ${entry.line}`.toLowerCase();
  return LOG_NOISE_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function disabledBackendAlert(overview?: MonitoringOverview) {
  if (!overview) return null;
  const disabled: string[] = [];
  const offline: string[] = [];

  if (!overview.prometheus.configured) disabled.push("Prometheus");
  else if (!overview.prometheus.reachable) offline.push("Prometheus");

  if (!overview.loki.configured) disabled.push("Loki");
  else if (!overview.loki.reachable) offline.push("Loki");

  if (disabled.length === 0 && offline.length === 0) return null;

  const descriptionParts: string[] = [];
  if (disabled.length > 0) {
    descriptionParts.push(`${disabled.join(" and ")} ${disabled.length === 1 ? "is" : "are"} not configured.`);
  }
  if (offline.length > 0) {
    descriptionParts.push(`${offline.join(" and ")} ${offline.length === 1 ? "is" : "are"} configured but unreachable.`);
  }

  return (
    <Alert
      type={offline.length > 0 ? "warning" : "info"}
      showIcon
      icon={<WarningOutlined />}
      message="Monitoring data is partially available."
      description={descriptionParts.join(" ")}
    />
  );
}

function BackendStatusCard({ overview }: { overview?: MonitoringOverview }) {
  return (
    <Card title="Backend Status">
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {[
          { name: "Prometheus", backend: overview?.prometheus },
          { name: "Loki", backend: overview?.loki },
        ].map(({ name, backend }) => {
          const ready = readinessTag(backend?.ready ?? null);
          const configured = backend?.configured ?? false;
          return (
            <div key={name}>
              <Space wrap>
                <Text strong>{name}</Text>
                <Tag color={!configured ? "default" : backend?.reachable ? "green" : "red"}>
                  {!configured ? "disabled" : backend?.reachable ? "reachable" : "offline"}
                </Tag>
                {configured && <Tag color={ready.color}>{ready.label}</Tag>}
              </Space>
              <div>
                <Text type="secondary">
                  {backend?.url || "Not configured"}
                  {backend?.version ? ` · v${backend.version}` : ""}
                  {backend?.error ? ` · ${backend.error}` : ""}
                </Text>
              </div>
            </div>
          );
        })}
      </Space>
    </Card>
  );
}

export default function MonitoringPage({ initialView = "overview" }: MonitoringPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [hostId, setHostId] = useState<number | undefined>(undefined);
  const [historyHours, setHistoryHours] = useState(24);
  const [serviceName, setServiceName] = useState<string | undefined>(undefined);
  const [logsSearch, setLogsSearch] = useState("");
  const [hideNoiseLogs, setHideNoiseLogs] = useState(true);
  const activeView = useMemo<MonitoringView>(() => {
    if (location.pathname.endsWith("/alerts")) return "alerts";
    if (location.pathname.endsWith("/capacity")) return "capacity";
    if (location.pathname.endsWith("/hosts")) return "hosts";
    if (location.pathname.endsWith("/services")) return "services";
    if (location.pathname.endsWith("/logs")) return "logs";
    return initialView;
  }, [initialView, location.pathname]);

  const hostsQuery = useQuery({
    queryKey: ["/hosts", "monitoring-selector"],
    queryFn: () => listRecords<Host>("/hosts", 0, 500),
  });

  const overviewQuery = useQuery({
    queryKey: ["/monitoring/overview", hostId],
    queryFn: () => getMonitoringOverview(hostId),
    refetchInterval: 30_000,
  });
  const historyQuery = useQuery({
    queryKey: ["/monitoring/history", hostId, historyHours],
    queryFn: () => getMonitoringHistory(historyHours, hostId),
    enabled: activeView === "overview" || activeView === "capacity",
    refetchInterval: activeView === "overview" || activeView === "capacity" ? 60_000 : false,
  });

  const logsQuery = useQuery({
    queryKey: ["/monitoring/logs", serviceName, hostId],
    queryFn: () => getMonitoringLogs(serviceName, 50, hostId),
    refetchInterval: 15_000,
  });
  const alertsQuery = useQuery({
    queryKey: ["/monitoring/alerts", hostId],
    queryFn: () => getMonitoringAlerts(hostId),
    refetchInterval: 30_000,
  });
  const launchMutation = useMutation({
    mutationFn: launchJobTemplate,
  });

  const overview = overviewQuery.data;

  const hostOptions = useMemo(
    () =>
      (hostsQuery.data?.items ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((host) => ({
          label: host.ipv4 ? `${host.name} (${host.ipv4})` : host.name,
          value: host.id,
        })),
    [hostsQuery.data?.items]
  );

  const services = useMemo(
    () => (overview?.log_volume ?? []).map((item) => ({ label: item.service_name, value: item.service_name })),
    [overview?.log_volume]
  );

  const hostRows = overview?.hosts ?? [];
  const alerts = alertsQuery.data?.items ?? [];
  const cpuAverage = average(hostRows.map((row) => row.cpu_usage_percent));
  const memoryAverage = average(hostRows.map((row) => row.memory_usage_percent));
  const diskAverage = average(hostRows.map((row) => row.root_disk_usage_percent));
  const downHosts = hostRows.filter((row) => !row.up).length;
  const hostsAtRisk = hostRows.filter((row) => row.health_score < 70).length;
  const busiestService = overview?.log_volume[0];
  const totalLogLines = (overview?.log_volume ?? []).reduce((sum, item) => sum + item.lines_last_hour, 0);
  const unhealthyJobs = (overview?.targets.jobs ?? []).filter((job) => job.unhealthy_targets > 0).length;
  const filteredLogs = useMemo(() => {
    const search = logsSearch.trim().toLowerCase();
    return (logsQuery.data?.items ?? []).filter((entry) => {
      if (hideNoiseLogs && logIsNoise(entry)) {
        return false;
      }
      if (!search) {
        return true;
      }
      const haystack = `${entry.service_name ?? ""} ${entry.level ?? ""} ${entry.instance ?? ""} ${entry.line}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [hideNoiseLogs, logsQuery.data?.items, logsSearch]);

  const hostColumns = [
    {
      title: "Host",
      dataIndex: "name",
      key: "name",
      render: (_: unknown, row: MonitoringHostStatus) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.name}</Text>
          <Text type="secondary">{row.instance}</Text>
        </Space>
      ),
    },
    {
      title: "Status",
      dataIndex: "up",
      key: "up",
      width: 120,
      render: (value: boolean) => <Tag color={statusColor(value)}>{value ? "up" : "down"}</Tag>,
    },
    {
      title: "Health",
      dataIndex: "health_score",
      key: "health_score",
      width: 120,
      render: (value: number) => <Tag color={value >= 90 ? "green" : value >= 70 ? "gold" : "red"}>{value}</Tag>,
      sorter: (a: MonitoringHostStatus, b: MonitoringHostStatus) => a.health_score - b.health_score,
      defaultSortOrder: "ascend" as const,
    },
    {
      title: "CPU",
      dataIndex: "cpu_usage_percent",
      key: "cpu_usage_percent",
      render: (value: number | null) => percent(value),
    },
    {
      title: "Memory",
      dataIndex: "memory_usage_percent",
      key: "memory_usage_percent",
      render: (value: number | null) => percent(value),
    },
    {
      title: "Root Disk",
      dataIndex: "root_disk_usage_percent",
      key: "root_disk_usage_percent",
      render: (value: number | null) => percent(value),
    },
  ];

  const tabItems = [
    { key: "overview", label: "Overview" },
    { key: "alerts", label: "Alert Center" },
    { key: "capacity", label: "Capacity" },
    { key: "hosts", label: "Host Health" },
    { key: "services", label: "Services" },
    { key: "logs", label: "Logs" },
  ];

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>Monitoring</Title>
          <Text type="secondary">
            Prometheus and Loki visibility for homelab targets, services, and logs.
          </Text>
        </div>
        <Space wrap>
          <Select
            allowClear
            showSearch
            placeholder="Filter by inventory host"
            style={{ minWidth: 260 }}
            value={hostId}
            options={hostOptions}
            onChange={(value) => {
              setHostId(value);
              setServiceName(undefined);
            }}
            optionFilterProp="label"
            loading={hostsQuery.isLoading}
          />
          <Button
            onClick={() => {
              void overviewQuery.refetch();
              void alertsQuery.refetch();
              void logsQuery.refetch();
              if (activeView === "overview" || activeView === "capacity") {
                void historyQuery.refetch();
              }
            }}
            loading={
              overviewQuery.isFetching
              || alertsQuery.isFetching
              || logsQuery.isFetching
              || historyQuery.isFetching
            }
          >
            Refresh
          </Button>
        </Space>
      </div>

      <Tabs activeKey={activeView} items={tabItems} onChange={(key) => navigate(viewPath(key as MonitoringView))} />

      {overview?.selected_host && (
        <Alert
          type="info"
          showIcon
          message={`Filtering monitoring data for ${overview.selected_host.name}${overview.selected_host.ipv4 ? ` (${overview.selected_host.ipv4})` : ""}.`}
        />
      )}

      {disabledBackendAlert(overview)}

      {activeView === "overview" && (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12} xl={6}>
              <Card loading={overviewQuery.isLoading}>
                <Statistic title="Targets" value={overview?.targets.total_targets ?? 0} prefix={<DatabaseOutlined />} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card loading={overviewQuery.isLoading}>
                <Statistic title="Healthy Targets" value={overview?.targets.healthy_targets ?? 0} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card loading={overviewQuery.isLoading}>
                <Statistic title="Unhealthy Jobs" value={unhealthyJobs} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card loading={overviewQuery.isLoading}>
                <Statistic title="Log Services" value={overview?.log_volume.length ?? 0} prefix={<LineChartOutlined />} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card loading={overviewQuery.isLoading}>
                <Statistic title="Hosts Down" value={downHosts} prefix={<CloudServerOutlined />} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card loading={overviewQuery.isLoading}>
                <Statistic title="Avg CPU" value={cpuAverage == null ? "—" : `${cpuAverage.toFixed(1)}%`} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card loading={overviewQuery.isLoading}>
                <Statistic title="Avg Memory" value={memoryAverage == null ? "—" : `${memoryAverage.toFixed(1)}%`} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card loading={overviewQuery.isLoading}>
                <Statistic title="Logs Last Hour" value={totalLogLines.toLocaleString()} prefix={<UnorderedListOutlined />} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card loading={alertsQuery.isLoading}>
                <Statistic title="Open Alerts" value={alerts.length} prefix={<WarningOutlined />} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card loading={overviewQuery.isLoading}>
                <Statistic title="Hosts At Risk" value={hostsAtRisk} prefix={<WarningOutlined />} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={10}>
              <BackendStatusCard overview={overview} />
            </Col>
            <Col xs={24} xl={14}>
              <Card title="Current Highlights" loading={overviewQuery.isLoading}>
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <Text>Prometheus targets down</Text>
                    <Text strong>{overview?.targets.unhealthy_targets ?? 0}</Text>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <Text>Average root disk use</Text>
                    <Text strong>{diskAverage == null ? "—" : `${diskAverage.toFixed(1)}%`}</Text>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <Text>Busiest log stream</Text>
                    <Text strong>{busiestService ? `${busiestService.service_name} (${busiestService.lines_last_hour.toLocaleString()}/hr)` : "—"}</Text>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <Text>Recent logs returned</Text>
                    <Text strong>{overview?.recent_logs.length ?? 0}</Text>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <Text>Open alerts</Text>
                    <Text strong>{alerts.length}</Text>
                  </div>
                </Space>
              </Card>
            </Col>
          </Row>

          <PrometheusHistorySection
            history={historyQuery.data}
            loading={historyQuery.isLoading}
            hours={historyHours}
            onHoursChange={setHistoryHours}
          />

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={12}>
              <Card title="Prometheus Jobs" loading={overviewQuery.isLoading}>
                <List
                  size="small"
                  dataSource={overview?.targets.jobs ?? []}
                  locale={{ emptyText: overview?.prometheus.configured ? "No target data." : "Prometheus is not configured." }}
                  renderItem={(item) => (
                    <List.Item>
                      <div style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <Text>{item.job}</Text>
                        <Text type={item.unhealthy_targets > 0 ? "danger" : undefined}>
                          {item.healthy_targets}/{item.total_targets} healthy
                        </Text>
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title="Recent Logs Snapshot" loading={logsQuery.isLoading}>
                <List
                  size="small"
                  dataSource={(logsQuery.data?.items ?? []).slice(0, 8)}
                  locale={{ emptyText: overview?.loki.configured ? "No logs returned." : "Loki is not configured." }}
                  renderItem={(item: MonitoringLogEntry) => (
                    <List.Item>
                      <Space direction="vertical" size={2} style={{ width: "100%" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <Space wrap>
                            <Tag>{item.service_name || "unknown"}</Tag>
                            {item.instance && <Text type="secondary">{item.instance}</Text>}
                          </Space>
                          <Text type="secondary">{formatDate(item.timestamp)}</Text>
                        </div>
                        <Paragraph ellipsis={{ rows: 2, expandable: false }} style={{ marginBottom: 0, fontFamily: "monospace" }}>
                          {item.line}
                        </Paragraph>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}

      {activeView === "alerts" && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="Open Alerts" value={alerts.length} prefix={<WarningOutlined />} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="Critical Alerts" value={alerts.filter((item) => item.severity === "critical").length} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="Runbook Matches" value={alerts.filter((item) => item.suggested_runbooks.length > 0).length} />
              </Card>
            </Col>
          </Row>
          <List
            dataSource={alerts}
            locale={{ emptyText: "No active alerts from the current monitoring inputs." }}
            renderItem={(item: MonitoringAlert) => (
              <List.Item>
                <Card style={{ width: "100%" }} title={<Space wrap><Tag color={severityColor(item.severity)}>{item.severity}</Tag><span>{item.title}</span></Space>}>
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Text>{item.description}</Text>
                    <Space wrap>
                      {item.host_name && <Tag>{item.host_name}</Tag>}
                      {item.service_name && <Tag color="blue">{item.service_name}</Tag>}
                      {item.metric_value != null && <Text type="secondary">Value: {item.metric_value.toFixed(1)}</Text>}
                      {item.threshold != null && <Text type="secondary">Threshold: {item.threshold.toFixed(1)}</Text>}
                    </Space>
                    {item.suggested_runbooks.length > 0 ? (
                      <Space direction="vertical" size={8} style={{ width: "100%" }}>
                        <Text strong>Suggested Runbooks</Text>
                        {item.suggested_runbooks.map((runbook) => (
                          <Card key={runbook.job_template_id} size="small" type="inner">
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                              <Space direction="vertical" size={2}>
                                <Space wrap>
                                  <Text strong>{runbook.name}</Text>
                                  {runbook.category && <Tag>{runbook.category}</Tag>}
                                  {runbook.risk_level && <Tag color={runbook.risk_level === "high" ? "red" : runbook.risk_level === "medium" ? "gold" : "green"}>{runbook.risk_level}</Tag>}
                                  {runbook.ai_enabled && <Tag color="purple">AI enabled</Tag>}
                                </Space>
                                {runbook.recommended_when && <Text type="secondary">{runbook.recommended_when}</Text>}
                                {runbook.ai_agents.length > 0 && (
                                  <Text type="secondary">Agents: {runbook.ai_agents.join(", ")}</Text>
                                )}
                              </Space>
                              <Space wrap>
                                <Button size="small" onClick={() => navigate(`/automation/job-templates`)}>Open Templates</Button>
                                <Button
                                  size="small"
                                  type="primary"
                                  disabled={!runbook.can_run || user?.role !== "admin"}
                                  loading={launchMutation.isPending}
                                  onClick={() => launchMutation.mutate(runbook.job_template_id)}
                                >
                                  Run
                                </Button>
                              </Space>
                            </div>
                          </Card>
                        ))}
                      </Space>
                    ) : (
                      <Text type="secondary">No linked runbooks for this alert yet.</Text>
                    )}
                  </Space>
                </Card>
              </List.Item>
            )}
          />
        </Space>
      )}

      {activeView === "capacity" && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <PrometheusHistorySection
            history={historyQuery.data}
            loading={historyQuery.isLoading}
            hours={historyHours}
            onHoursChange={setHistoryHours}
            title="Capacity Trend History"
          />
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="Avg CPU" value={cpuAverage == null ? "—" : `${cpuAverage.toFixed(1)}%`} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="Avg Memory" value={memoryAverage == null ? "—" : `${memoryAverage.toFixed(1)}%`} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="Avg Root Disk" value={diskAverage == null ? "—" : `${diskAverage.toFixed(1)}%`} />
              </Card>
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={12}>
              <Card title="Top CPU Pressure">
                <List
                  size="small"
                  dataSource={[...hostRows].sort((a, b) => (b.cpu_usage_percent ?? -1) - (a.cpu_usage_percent ?? -1)).slice(0, 10)}
                  renderItem={(item) => (
                    <List.Item>
                      <div style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <Text>{item.name}</Text>
                        <Text strong>{percent(item.cpu_usage_percent)}</Text>
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title="Top Disk Pressure">
                <List
                  size="small"
                  dataSource={[...hostRows].sort((a, b) => (b.root_disk_usage_percent ?? -1) - (a.root_disk_usage_percent ?? -1)).slice(0, 10)}
                  renderItem={(item) => (
                    <List.Item>
                      <div style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <Text>{item.name}</Text>
                        <Text strong>{percent(item.root_disk_usage_percent)}</Text>
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          </Row>
        </Space>
      )}

      {activeView === "hosts" && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="Hosts Reporting" value={hostRows.length} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="Hosts Down" value={downHosts} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card>
                <Statistic title="Hosts At Risk" value={hostsAtRisk} />
              </Card>
            </Col>
          </Row>
          <Card title="Host Health">
            <Table
              rowKey={(row) => row.instance}
              pagination={{ pageSize: 25 }}
              columns={hostColumns}
              dataSource={hostRows}
              locale={{ emptyText: overview?.prometheus.configured ? "No node exporter host metrics available." : "Prometheus is not configured." }}
              scroll={{ x: 720 }}
            />
          </Card>
        </Space>
      )}

      {activeView === "services" && (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <Card title="Top Log Volume" loading={overviewQuery.isLoading}>
              <Space direction="vertical" size={14} style={{ width: "100%" }}>
                {(overview?.log_volume ?? []).slice(0, 10).map((item) => {
                  const total = busiestService?.lines_last_hour ?? 1;
                  const percentValue = total > 0 ? (item.lines_last_hour / total) * 100 : 0;
                  return (
                    <div key={item.service_name}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <Text>{item.service_name}</Text>
                        <Text>{item.lines_last_hour.toLocaleString()} / hr</Text>
                      </div>
                      <Progress percent={Math.round(percentValue)} showInfo={false} size="small" />
                    </div>
                  );
                })}
                {overview?.log_volume.length === 0 && (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={overview?.loki.configured ? "No Loki volume data available." : "Loki is not configured."}
                  />
                )}
              </Space>
            </Card>
          </Col>
          <Col xs={24} xl={14}>
            <Card title="Service Activity" loading={overviewQuery.isLoading}>
              <List
                size="small"
                dataSource={overview?.log_volume ?? []}
                locale={{ emptyText: overview?.loki.configured ? "No service activity found." : "Loki is not configured." }}
                renderItem={(item) => (
                  <List.Item>
                    <div style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <Space wrap>
                        <Tag color="blue">{item.service_name}</Tag>
                        <Text type="secondary">last hour</Text>
                      </Space>
                      <Text strong>{item.lines_last_hour.toLocaleString()} lines</Text>
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
      )}

      {activeView === "logs" && (
        <Card
          title="Recent Logs"
          extra={
            <Space wrap>
              <Checkbox checked={hideNoiseLogs} onChange={(e: CheckboxChangeEvent) => setHideNoiseLogs(e.target.checked)}>
                Hide noise
              </Checkbox>
              <Select
                allowClear
                placeholder="Filter by service"
                style={{ minWidth: 180 }}
                value={serviceName}
                options={services}
                onChange={(value) => setServiceName(value)}
              />
              <Input.Search
                allowClear
                placeholder="Filter logs"
                value={logsSearch}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setLogsSearch(e.target.value)}
                style={{ minWidth: 220 }}
              />
              <Button
                onClick={() => {
                  setHideNoiseLogs(false);
                  setServiceName(undefined);
                  setLogsSearch("");
                }}
              >
                Clear Filters
              </Button>
            </Space>
          }
          loading={logsQuery.isLoading}
        >
          <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
            Noise filtering hides common Alloy, scrape, and debug chatter by default.
          </Text>
          <List
            size="small"
            dataSource={filteredLogs}
            locale={{ emptyText: overview?.loki.configured ? "No logs returned." : "Loki is not configured." }}
            renderItem={(item: MonitoringLogEntry) => (
              <List.Item>
                <Space direction="vertical" size={2} style={{ width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <Space wrap>
                      <Tag>{item.service_name || "unknown"}</Tag>
                      {item.level && <Tag color={item.level === "info" ? "blue" : "default"}>{item.level}</Tag>}
                      {item.instance && <Text type="secondary">{item.instance}</Text>}
                    </Space>
                    <Text type="secondary">{formatDate(item.timestamp)}</Text>
                  </div>
                  <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                    {item.line}
                  </Paragraph>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}
    </Space>
  );
}
