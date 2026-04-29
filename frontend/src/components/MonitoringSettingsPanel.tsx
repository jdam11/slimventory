import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listJobTemplates } from "../api/job_templates";
import {
  createMonitoringSecretMapping,
  deleteMonitoringSecretMapping,
  getMonitoringSettings,
  listMonitoringSecretMappings,
  updateMonitoringSecretMapping,
  updateMonitoringSettings,
} from "../api/monitoring";
import type {
  JobTemplate,
  MonitoringSecretMapping,
  MonitoringSecretMappingCreate,
  MonitoringSecretMappingUpdate,
  MonitoringSettings,
  MonitoringSettingsUpdate,
  SecretInjectionMode,
} from "../types";

const { Paragraph } = Typography;

type MappingFormValues = MonitoringSecretMappingCreate;

const AUTH_OPTIONS = [
  { value: "none", label: "None" },
  { value: "basic", label: "Basic auth" },
  { value: "bearer", label: "Bearer token" },
];

const INJECTION_OPTIONS: { value: SecretInjectionMode; label: string }[] = [
  { value: "extra_vars", label: "extra_vars" },
  { value: "vault_password_file", label: "vault_password_file" },
];

function secretPlaceholder(hasSecret: boolean, label: string) {
  return hasSecret ? `Leave blank to keep existing ${label}` : `Enter ${label}`;
}

function stripEmptySecrets(payload: MonitoringSettingsUpdate, current?: MonitoringSettings): MonitoringSettingsUpdate {
  const cleaned: MonitoringSettingsUpdate = { ...payload };
  for (const section of ["prometheus", "loki"] as const) {
    const value = cleaned[section];
    if (!value) continue;
    const currentSection = current?.[section];
    if (value.password === "") {
      if (currentSection?.has_password) {
        delete value.password;
      } else {
        value.password = undefined;
      }
    }
    if (value.bearer_token === "") {
      if (currentSection?.has_bearer_token) {
        delete value.bearer_token;
      } else {
        value.bearer_token = undefined;
      }
    }
    if (value.username === "") {
      value.username = undefined;
    }
    if (value.url === "") {
      value.url = undefined;
    }
  }
  return cleaned;
}

export default function MonitoringSettingsPanel() {
  const qc = useQueryClient();
  const [settingsForm] = Form.useForm<MonitoringSettingsUpdate>();
  const [mappingForm] = Form.useForm<MappingFormValues>();
  const [editingMapping, setEditingMapping] = useState<MonitoringSecretMapping | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["/monitoring/settings"],
    queryFn: getMonitoringSettings,
  });
  const mappingsQuery = useQuery({
    queryKey: ["/monitoring/secret-mappings"],
    queryFn: () => listMonitoringSecretMappings(),
  });
  const templatesQuery = useQuery({
    queryKey: ["/job-templates", "monitoring-settings"],
    queryFn: () => listJobTemplates(0, 200),
  });

  useEffect(() => {
    const data = settingsQuery.data;
    if (!data) return;
    settingsForm.setFieldsValue({
      prometheus: {
        enabled: data.prometheus.enabled,
        url: data.prometheus.url ?? undefined,
        timeout_seconds: data.prometheus.timeout_seconds,
        verify_tls: data.prometheus.verify_tls,
        auth_type: data.prometheus.auth_type,
        username: data.prometheus.username ?? undefined,
        password: undefined,
        bearer_token: undefined,
      },
      loki: {
        enabled: data.loki.enabled,
        url: data.loki.url ?? undefined,
        timeout_seconds: data.loki.timeout_seconds,
        verify_tls: data.loki.verify_tls,
        auth_type: data.loki.auth_type,
        username: data.loki.username ?? undefined,
        password: undefined,
        bearer_token: undefined,
      },
    });
  }, [settingsForm, settingsQuery.data]);

  const settingsMutation = useMutation({
    mutationFn: async (payload: MonitoringSettingsUpdate) =>
      updateMonitoringSettings(stripEmptySecrets(payload, settingsQuery.data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/monitoring/settings"] });
      message.success("Monitoring settings saved.");
    },
  });

  const createMappingMutation = useMutation({
    mutationFn: createMonitoringSecretMapping,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/monitoring/secret-mappings"] });
      message.success("Secret mapping created.");
      setMappingOpen(false);
    },
  });

  const updateMappingMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: MonitoringSecretMappingUpdate }) =>
      updateMonitoringSecretMapping(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/monitoring/secret-mappings"] });
      message.success("Secret mapping updated.");
      setMappingOpen(false);
    },
  });

  const deleteMappingMutation = useMutation({
    mutationFn: deleteMonitoringSecretMapping,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/monitoring/secret-mappings"] });
      message.success("Secret mapping deleted.");
    },
  });

  const templateOptions = useMemo(
    () =>
      (templatesQuery.data?.items ?? []).map((template: JobTemplate) => ({
        value: template.id,
        label: template.name,
      })),
    [templatesQuery.data?.items]
  );

  function openCreateMapping() {
    setEditingMapping(null);
    mappingForm.resetFields();
    mappingForm.setFieldsValue({
      name: "",
      item_reference: "",
      item_field: "password",
      ansible_var_name: "",
      injection_mode: "extra_vars",
      is_enabled: true,
    });
    setMappingOpen(true);
  }

  function openEditMapping(mapping: MonitoringSecretMapping) {
    setEditingMapping(mapping);
    mappingForm.setFieldsValue({
      name: mapping.name,
      job_template_id: mapping.job_template_id ?? undefined,
      item_reference: mapping.item_reference,
      item_field: mapping.item_field,
      ansible_var_name: mapping.ansible_var_name,
      injection_mode: mapping.injection_mode,
      is_enabled: mapping.is_enabled,
    });
    setMappingOpen(true);
  }

  function submitSettings(values: MonitoringSettingsUpdate) {
    settingsMutation.mutate(values);
  }

  function submitMapping(values: MappingFormValues) {
    if (editingMapping) {
      updateMappingMutation.mutate({ id: editingMapping.id, payload: values });
    } else {
      createMappingMutation.mutate(values);
    }
  }

  const mappings = mappingsQuery.data ?? [];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="Monitoring settings are admin-only."
        description="Prometheus/Loki endpoints and secret mappings are stored here and injected at runtime."
      />

      <Form form={settingsForm} layout="vertical" onFinish={submitSettings}>
        <Card title="Prometheus">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="Enabled" name={["prometheus", "enabled"]} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="URL" name={["prometheus", "url"]}>
                <Input placeholder="https://prometheus.example.local" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Timeout (seconds)" name={["prometheus", "timeout_seconds"]}>
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Verify TLS" name={["prometheus", "verify_tls"]} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Auth Type" name={["prometheus", "auth_type"]}>
                <Select options={AUTH_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Username" name={["prometheus", "username"]}>
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Password" name={["prometheus", "password"]}>
                <Input.Password placeholder={secretPlaceholder(!!settingsQuery.data?.prometheus.has_password, "password")} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="Bearer Token" name={["prometheus", "bearer_token"]}>
                <Input.Password placeholder={secretPlaceholder(!!settingsQuery.data?.prometheus.has_bearer_token, "token")} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="Loki" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="Enabled" name={["loki", "enabled"]} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="URL" name={["loki", "url"]}>
                <Input placeholder="https://loki.example.local" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Timeout (seconds)" name={["loki", "timeout_seconds"]}>
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Verify TLS" name={["loki", "verify_tls"]} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Auth Type" name={["loki", "auth_type"]}>
                <Select options={AUTH_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Username" name={["loki", "username"]}>
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Password" name={["loki", "password"]}>
                <Input.Password placeholder={secretPlaceholder(!!settingsQuery.data?.loki.has_password, "password")} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="Bearer Token" name={["loki", "bearer_token"]}>
                <Input.Password placeholder={secretPlaceholder(!!settingsQuery.data?.loki.has_bearer_token, "token")} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Space style={{ marginTop: 16 }}>
          <Button type="primary" htmlType="submit" loading={settingsMutation.isPending}>
            Save Monitoring Settings
          </Button>
        </Space>
      </Form>

      <Card
        title="Secret Mappings"
        extra={
          <Button icon={<PlusOutlined />} type="primary" onClick={openCreateMapping}>
            Add Mapping
          </Button>
        }
      >
        <Paragraph type="secondary">
          Map a Bitwarden/Vaultwarden item/field to an Ansible variable name. Select `vault_password_file` when
          the playbook expects a vault password file.
        </Paragraph>
        <Table<MonitoringSecretMapping>
          rowKey="id"
          loading={mappingsQuery.isLoading}
          dataSource={mappings}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "Name", dataIndex: "name" },
            {
              title: "Scope",
              dataIndex: "job_template_id",
              render: (value: number | null) => (
                <Tag color={value == null ? "default" : "blue"}>{value == null ? "Global" : `Template #${value}`}</Tag>
              ),
            },
            { title: "Item", dataIndex: "item_reference" },
            { title: "Field", dataIndex: "item_field" },
            { title: "Ansible Var", dataIndex: "ansible_var_name" },
            {
              title: "Mode",
              dataIndex: "injection_mode",
              render: (value: SecretInjectionMode) => <Tag>{value}</Tag>,
            },
            {
              title: "Enabled",
              dataIndex: "is_enabled",
              render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "Yes" : "No"}</Tag>,
            },
            {
              title: "Actions",
              render: (_: unknown, record: MonitoringSecretMapping) => (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEditMapping(record)} />
                  <Popconfirm title="Delete this mapping?" onConfirm={() => deleteMappingMutation.mutate(record.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editingMapping ? "Edit Secret Mapping" : "Create Secret Mapping"}
        open={mappingOpen}
        onCancel={() => setMappingOpen(false)}
        onOk={() => mappingForm.submit()}
        confirmLoading={createMappingMutation.isPending || updateMappingMutation.isPending}
      >
        <Form form={mappingForm} layout="vertical" onFinish={submitMapping}>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: "Name is required" }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Run Scope" name="job_template_id">
            <Select
              allowClear
              placeholder="Global or job template"
              options={[{ value: null, label: "Global" }, ...templateOptions]}
            />
          </Form.Item>
          <Form.Item
            label="Bitwarden Item Reference"
            name="item_reference"
            rules={[{ required: true, message: "Item reference is required" }]}
          >
            <Input placeholder="Item name, short ID, or UUID" />
          </Form.Item>
          <Form.Item label="Item Field" name="item_field" rules={[{ required: true, message: "Item field is required" }]}>
            <Input placeholder="password or custom field name" />
          </Form.Item>
          <Form.Item
            label="Ansible Variable Name"
            name="ansible_var_name"
            rules={[{ required: true, message: "Variable name is required" }]}
          >
            <Input placeholder="api_token" />
          </Form.Item>
          <Form.Item label="Injection Mode" name="injection_mode" rules={[{ required: true }]}>
            <Select options={INJECTION_OPTIONS} />
          </Form.Item>
          <Form.Item label="Enabled" name="is_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
