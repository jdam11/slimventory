import { Divider, Typography } from "antd";
import AssistantPanel from "../../components/AssistantPanel";

const { Title, Text } = Typography;

export default function AiSettingsPage() {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          AI Settings
        </Title>
        <Text type="secondary">
          Admin-only controls for AI providers, agents, tools, and feature flags.
        </Text>
      </div>
      <Divider />
      <AssistantPanel showChat={false} showAdminTabs />
    </div>
  );
}
