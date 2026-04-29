import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Form, Input, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  getUnifiSettings,
  importUnifiVlans,
  listUnifiRuns,
  listUnifiSites,
  previewUnifiVlans,
  triggerUnifiSync,
  updateUnifiSettings,
  type UnifiSettingsInput,
} from "../api/unifi";
import type { UnifiSettings, UnifiSite, UnifiSyncRun, UnifiVlanPreview } from "../types";

const { Paragraph, Text, Title } = Typography;

export default function UnifiPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm<UnifiSettingsInput>();
  const [selectedNetworkIds, setSelectedNetworkIds] = useState<string[]>([]);

  const { data: settings, isFetching: settingsLoading } = useQuery({
    queryKey: ["/unifi/settings"],
    queryFn: getUnifiSettings,
  });
  const { data: runs, isFetching: runsLoading } = useQuery({
    queryKey: ["/unifi/runs"],
    queryFn: () => listUnifiRuns(0, 20),
  });
  const {
    data: sites,
    isFetching: sitesLoading,
    refetch: refetchSites,
  } = useQuery({
    queryKey: ["/unifi/sites"],
    queryFn: listUnifiSites,
    enabled: false,
  });
  const {
    data: vlanPreview,
    isFetching: vlanPreviewLoading,
    refetch: refetchVlanPreview,
  } = useQuery({
    queryKey: ["/unifi/vlans/preview"],
    queryFn: previewUnifiVlans,
    enabled: false,
  });

  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        enabled: settings.enabled,
        base_url: settings.base_url,
        username: settings.username,
        site: settings.site,
        verify_tls: settings.verify_tls,
      });
    }
  }, [form, settings]);

  useEffect(() => {
    setSelectedNetworkIds((current) =>
      current.filter((networkId) => (vlanPreview ?? []).some((item) => item.network_id === networkId))
    );
  }, [vlanPreview]);

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["/unifi/settings"] }),
      qc.invalidateQueries({ queryKey: ["/unifi/runs"] }),
      qc.invalidateQueries({ queryKey: ["/hosts"] }),
      qc.invalidateQueries({ queryKey: ["/vlans"] }),
    ]);
  };

  const saveSettingsMut = useMutation({
    mutationFn: updateUnifiSettings,
    onSuccess: async (data: UnifiSettings) => {
      await invalidateAll();
      form.setFieldValue("password", undefined);
      message.success(data.enabled ? "UniFi settings saved" : "UniFi settings updated");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to save UniFi settings"
      );
    },
  });

  const syncMut = useMutation({
    mutationFn: () => triggerUnifiSync({ trigger_source: "manual" }),
    onSuccess: async () => {
      await invalidateAll();
      message.success("UniFi sync completed");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "UniFi sync failed"
      );
    },
  });

  const importVlansMut = useMutation({
    mutationFn: () => importUnifiVlans(selectedNetworkIds),
    onSuccess: async (result) => {
      await invalidateAll();
      message.success(
        `Imported VLANs: ${result.created} created, ${result.updated} updated, ${result.skipped} unchanged`
      );
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to import UniFi VLANs"
      );
    },
  });

  const siteOptions = (sites ?? []).map((site: UnifiSite) => ({
    label: site.description ? `${site.name} (${site.description})` : site.name,
    value: site.id,
  }));

  const runColumns: ColumnsType<UnifiSyncRun> = [
    { title: "Run", dataIndex: "id", key: "id", width: 80 },
    { title: "Status", dataIndex: "status", key: "status", width: 120, render: (value: string) => <Tag color={value === "success" ? "green" : value === "failed" ? "red" : "blue"}>{value}</Tag> },
    { title: "Trigger", dataIndex: "trigger_source", key: "trigger_source", width: 120 },
    { title: "Started", dataIndex: "started_at", key: "started_at", width: 180, render: (value: string) => new Date(value).toLocaleString() },
    { title: "Message", dataIndex: "message", key: "message" },
  ];

  const vlanColumns: ColumnsType<UnifiVlanPreview> = useMemo(
    () => [
      { title: "Network", dataIndex: "name", key: "name" },
      { title: "VLAN", dataIndex: "vlan_tag", key: "vlan_tag", width: 100 },
      { title: "Subnet", dataIndex: "subnet", key: "subnet", width: 180, render: (value: string | null) => value ?? "-" },
      { title: "Purpose", dataIndex: "purpose", key: "purpose", width: 140, render: (value: string | null) => value ?? "-" },
    ],
    []
  );

  const handleSave = async () => {
    const values = await form.validateFields();
    saveSettingsMut.mutate(values);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card loading={settingsLoading}>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Title level={3} style={{ margin: 0 }}>
            UniFi Integration
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Pull VLANs, DHCP client IPs, and gateway port-forward observations from UniFi. This integration is read-only.
          </Paragraph>
        </Space>
      </Card>

      <Card
        title="Controller Settings"
        extra={
          <Space>
            <Button onClick={() => refetchSites()} loading={sitesLoading}>
              Load Sites
            </Button>
            <Button type="primary" onClick={handleSave} loading={saveSettingsMut.isPending}>
              Save Settings
            </Button>
          </Space>
        }
      >
        <Form<UnifiSettingsInput> form={form} layout="vertical">
          <Form.Item name="enabled" label="Enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="base_url" label="Controller URL">
            <Input placeholder="https://unifi.example.local" />
          </Form.Item>
          <Form.Item name="username" label="Username">
            <Input />
          </Form.Item>
          <Form.Item name="password" label={settings?.has_password ? "Password (leave blank to keep current)" : "Password"}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="verify_tls" label="Verify TLS" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="site" label="Site">
            <Select
              allowClear
              placeholder="Load sites after saving credentials"
              options={siteOptions}
              notFoundContent={sitesLoading ? "Loading..." : "No sites loaded"}
            />
          </Form.Item>
        </Form>
        <Space direction="vertical" size={2}>
          <Text type="secondary">
            Last sync: {settings?.last_sync_at ? new Date(settings.last_sync_at).toLocaleString() : "Never"}
          </Text>
          {settings?.last_sync_error ? <Text type="danger">Last error: {settings.last_sync_error}</Text> : null}
        </Space>
      </Card>

      <Card
        title="Manual Sync"
        extra={
          <Button type="primary" onClick={() => syncMut.mutate()} loading={syncMut.isPending}>
            Pull From UniFi
          </Button>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Sync updates read-only host observations and records current gateway port-forward rules. Inventory hostnames and owned IP fields are not overwritten.
        </Paragraph>
        <Table<UnifiSyncRun>
          rowKey="id"
          columns={runColumns}
          dataSource={runs?.items ?? []}
          loading={runsLoading}
          pagination={false}
          size="small"
        />
      </Card>

      <Card
        title="VLAN Import"
        extra={
          <Space>
            <Button onClick={() => refetchVlanPreview()} loading={vlanPreviewLoading}>
              Preview UniFi VLANs
            </Button>
            <Button
              type="primary"
              disabled={selectedNetworkIds.length === 0}
              loading={importVlansMut.isPending}
              onClick={() => importVlansMut.mutate()}
            >
              Import Selected
            </Button>
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Preview does not change inventory. Import explicitly creates or updates VLAN catalog rows from the selected UniFi networks.
        </Paragraph>
        <Table<UnifiVlanPreview>
          rowKey="network_id"
          columns={vlanColumns}
          dataSource={vlanPreview ?? []}
          loading={vlanPreviewLoading}
          pagination={false}
          size="small"
          rowSelection={{
            selectedRowKeys: selectedNetworkIds,
            onChange: (keys) => setSelectedNetworkIds(keys.map(String)),
          }}
        />
      </Card>
    </Space>
  );
}
