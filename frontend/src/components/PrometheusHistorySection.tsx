import { Card, Col, Empty, Row, Select, Space, Typography, theme as antdTheme } from "antd";
import type { CSSProperties } from "react";
import type { MonitoringHistory, MonitoringSeries } from "../types";

const { Text } = Typography;

const HISTORY_RANGE_OPTIONS = [
  { label: "6h", value: 6 },
  { label: "12h", value: 12 },
  { label: "24h", value: 24 },
  { label: "3d", value: 72 },
  { label: "7d", value: 168 },
];

function formatMetric(value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (unit === "percent") return `${value.toFixed(1)}%`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function seriesColor(key: string, fallback: string, success: string, warning: string, error: string): string {
  if (key === "target_availability") return success;
  if (key === "memory_usage_percent") return warning;
  if (key === "root_disk_usage_percent") return error;
  return fallback;
}

function buildChartPoints(series: MonitoringSeries, width: number, height: number, padding: number): string {
  if (series.points.length === 0) return "";
  const values = series.points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return series.points
    .map((point, index) => {
      const x = padding + (index / Math.max(1, series.points.length - 1)) * (width - padding * 2);
      const y = height - padding - ((point.value - min) / span) * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildAreaPath(series: MonitoringSeries, width: number, height: number, padding: number): string {
  const points = buildChartPoints(series, width, height, padding);
  if (!points) return "";
  const first = points.split(" ")[0];
  const last = points.split(" ").slice(-1)[0];
  if (!first || !last) return "";
  const [lastX] = last.split(",");
  const [firstX] = first.split(",");
  return `M ${firstX} ${height - padding} L ${points.replace(/ /g, " L ")} L ${lastX} ${height - padding} Z`;
}

function HistoryMetricCard({ series }: { series: MonitoringSeries }) {
  const { token } = antdTheme.useToken();
  const latest = series.points.length > 0 ? series.points[series.points.length - 1].value : null;
  const min = series.points.length > 0 ? Math.min(...series.points.map((point) => point.value)) : null;
  const max = series.points.length > 0 ? Math.max(...series.points.map((point) => point.value)) : null;
  const width = 320;
  const height = 92;
  const padding = 8;
  const stroke = seriesColor(
    series.key,
    token.colorPrimary,
    token.colorSuccess,
    token.colorWarning,
    token.colorError,
  );
  const polyline = buildChartPoints(series, width, height, padding);
  const areaPath = buildAreaPath(series, width, height, padding);
  const lastPoint = polyline ? polyline.split(" ").slice(-1)[0] : undefined;
  const [lastX, lastY] = lastPoint ? lastPoint.split(",") : [undefined, undefined];
  const chartStyle: CSSProperties = {
    width: "100%",
    height: 92,
    display: "block",
  };

  return (
    <div
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        padding: 12,
        background: token.colorBgElevated,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginBottom: 6 }}>
        <Text strong>{series.label}</Text>
        <Text strong style={{ fontSize: 18 }}>{formatMetric(latest, series.unit)}</Text>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <Text type="secondary">Low {formatMetric(min, series.unit)}</Text>
        <Text type="secondary">High {formatMetric(max, series.unit)}</Text>
      </div>
      {series.points.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Prometheus history returned." />
      ) : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={chartStyle} aria-hidden="true">
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke={token.colorBorderSecondary} strokeWidth="1" />
            {areaPath && <path d={areaPath} fill={stroke} opacity="0.14" />}
            <polyline fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={polyline} />
            {lastX && lastY && (
              <circle
                cx={lastX}
                cy={lastY}
                r="3.5"
                fill={stroke}
              />
            )}
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
            <Text type="secondary">{new Date(series.points[0].timestamp).toLocaleString()}</Text>
            <Text type="secondary">{new Date(series.points[series.points.length - 1].timestamp).toLocaleString()}</Text>
          </div>
        </>
      )}
    </div>
  );
}

interface PrometheusHistorySectionProps {
  history?: MonitoringHistory;
  loading?: boolean;
  hours: number;
  onHoursChange: (hours: number) => void;
  title?: string;
}

export default function PrometheusHistorySection({
  history,
  loading = false,
  hours,
  onHoursChange,
  title = "Prometheus Trend History",
}: PrometheusHistorySectionProps) {
  const scope = history?.selected_host
    ? `Last ${history.range_hours} hours for ${history.selected_host.name}`
    : `Last ${history?.range_hours ?? hours} hours across monitored hosts`;

  return (
    <Card
      title={title}
      loading={loading}
      extra={
        <Space wrap>
          <Text type="secondary">{scope}</Text>
          <Select
            size="small"
            style={{ width: 92 }}
            value={hours}
            options={HISTORY_RANGE_OPTIONS}
            onChange={onHoursChange}
          />
        </Space>
      }
    >
      {!history?.prometheus.configured ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Prometheus is not configured." />
      ) : !history.prometheus.reachable ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Prometheus is configured but unreachable." />
      ) : (
        <Row gutter={[12, 12]}>
          {(history.series ?? []).map((series) => (
            <Col xs={24} md={12} xl={12} key={series.key}>
              <HistoryMetricCard series={series} />
            </Col>
          ))}
        </Row>
      )}
    </Card>
  );
}
