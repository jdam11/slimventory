import { Divider, Typography } from "antd";
import BitwardenSettingsPanel from "../../components/BitwardenSettingsPanel";

const { Title, Text } = Typography;

export default function BitwardenSettingsPage() {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          Bitwarden Settings
        </Title>
        <Text type="secondary">Admin-only controls for the Bitwarden/Vaultwarden configuration.</Text>
      </div>
      <Divider />
      <BitwardenSettingsPanel />
    </div>
  );
}
