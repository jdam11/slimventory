import { Alert, Button, Card, Col, Form, Input, Row, Select, Space, Switch, Typography, message } from "antd";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMonitoringSettings, updateMonitoringSettings } from "../api/monitoring";
import type { MonitoringSettings, MonitoringSettingsUpdate } from "../types";

const { Text } = Typography;

const AUTH_METHOD_OPTIONS = [{ value: "token", label: "Token" }];

function secretPlaceholder(hasSecret: boolean, label: string) {
  return hasSecret ? `Leave blank to keep existing ${label}` : `Enter ${label}`;
}

function stripEmptyBitwarden(payload: MonitoringSettingsUpdate, current?: MonitoringSettings): MonitoringSettingsUpdate {
  const cleaned: MonitoringSettingsUpdate = { bitwarden: payload.bitwarden ? { ...payload.bitwarden } : undefined };
  const bitwarden = cleaned.bitwarden;
  if (!bitwarden) {
    return cleaned;
  }
  if (bitwarden.access_token === "") {
    if (current?.bitwarden.has_access_token) {
      delete bitwarden.access_token;
    } else {
      bitwarden.access_token = undefined;
    }
  }
  if (bitwarden.server_url === "") bitwarden.server_url = undefined;
  if (bitwarden.organization_id === "") bitwarden.organization_id = undefined;
  if (bitwarden.collection_id === "") bitwarden.collection_id = undefined;
  return cleaned;
}

export default function BitwardenSettingsPanel() {
  const qc = useQueryClient();
  const [form] = Form.useForm<MonitoringSettingsUpdate>();
  const settingsQuery = useQuery({
    queryKey: ["/monitoring/settings"],
    queryFn: getMonitoringSettings,
  });

  useEffect(() => {
    const data = settingsQuery.data;
    if (!data) return;
    form.setFieldsValue({
      bitwarden: {
        enabled: data.bitwarden.enabled,
        server_url: data.bitwarden.server_url ?? undefined,
        access_token: undefined,
        verify_tls: data.bitwarden.verify_tls,
        organization_id: data.bitwarden.organization_id ?? undefined,
        collection_id: data.bitwarden.collection_id ?? undefined,
        auth_method: data.bitwarden.auth_method,
      },
    });
  }, [form, settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: async (payload: MonitoringSettingsUpdate) => updateMonitoringSettings(stripEmptyBitwarden(payload, settingsQuery.data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/monitoring/settings"] });
      message.success("Bitwarden settings saved.");
    },
  });

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="Bitwarden/Vaultwarden configuration is admin-only."
        description={
          <>
            <Text>These credentials are injected into automation jobs that need secure secrets.</Text>
          </>
        }
      />
      <Card title="Bitwarden / Vaultwarden">
        <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="Enabled" name={["bitwarden", "enabled"]} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Server URL" name={["bitwarden", "server_url"]}>
                <Input placeholder="https://vaultwarden.example.local" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Access Token" name={["bitwarden", "access_token"]}>
                <Input.Password placeholder={secretPlaceholder(!!settingsQuery.data?.bitwarden.has_access_token, "access token")} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Auth Method" name={["bitwarden", "auth_method"]}>
                <Select options={AUTH_METHOD_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Organization ID" name={["bitwarden", "organization_id"]}>
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Collection ID" name={["bitwarden", "collection_id"]}>
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Verify TLS" name={["bitwarden", "verify_tls"]} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit" loading={mutation.isPending}>
              Save Bitwarden Settings
            </Button>
          </Space>
        </Form>
      </Card>
    </Space>
  );
}
