import { Divider, Typography } from "antd";
import MonitoringSettingsPanel from "../../components/MonitoringSettingsPanel";

const { Title, Text } = Typography;

export default function MonitoringSettingsPage() {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          Monitoring Settings
        </Title>
        <Text type="secondary">Admin-only controls for Prometheus/Loki endpoints and secret mappings.</Text>
      </div>
      <Divider />
      <MonitoringSettingsPanel />
    </div>
  );
}
