import { useMemo, useState } from "react";
import { Alert, Button, Divider, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { CopyOutlined, DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createInventoryApiKey,
  deleteInventoryApiKey,
  listInventoryApiKeys,
  rotateInventoryApiKey,
  updateInventoryApiKey,
} from "../../api/admin";
import type { InventoryApiKey, InventoryApiKeyCreate, InventoryApiKeyPermission } from "../../types";

const { Title, Text, Paragraph } = Typography;

const PERMISSION_OPTIONS: { value: InventoryApiKeyPermission; label: string }[] = [
  { value: "ansible_inventory_read", label: "Ansible Inventory Read" },
];

interface FormValues {
  name: string;
  description?: string;
  permissions: InventoryApiKeyPermission[];
  is_active: boolean;
}

export default function InventoryApiKeysPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [editing, setEditing] = useState<InventoryApiKey | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["/admin/inventory-api-keys"],
    queryFn: listInventoryApiKeys,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/admin/inventory-api-keys"] });

  const createMutation = useMutation({
    mutationFn: createInventoryApiKey,
    onSuccess: (result) => {
      invalidate();
      setModalOpen(false);
      setRevealedSecret(result.api_key);
      message.success("Inventory API key created.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<InventoryApiKeyCreate> }) => updateInventoryApiKey(id, payload),
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      message.success("Inventory API key updated.");
    },
  });

  const rotateMutation = useMutation({
    mutationFn: rotateInventoryApiKey,
    onSuccess: (result) => {
      invalidate();
      setRevealedSecret(result.api_key);
      message.success("Inventory API key rotated.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteInventoryApiKey,
    onSuccess: () => {
      invalidate();
      message.success("Inventory API key deleted.");
    },
  });

  const sortedKeys = useMemo(
    () => [...(keysQuery.data ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [keysQuery.data]
  );

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ permissions: ["ansible_inventory_read"], is_active: true });
    setModalOpen(true);
  }

  function openEdit(key: InventoryApiKey) {
    setEditing(key);
    form.setFieldsValue({
      name: key.name,
      description: key.description ?? undefined,
      permissions: key.permissions,
      is_active: key.is_active,
    });
    setModalOpen(true);
  }

  function handleSubmit(values: FormValues) {
    const payload = {
      name: values.name,
      description: values.description ?? null,
      permissions: values.permissions,
      is_active: values.is_active,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Inventory API Keys
          </Title>
          <Text type="secondary">
            Admin-managed keys for `/api/inventory/ansible`. These replace the static shared-token workflow with named, scoped credentials.
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          New Key
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        message="Managed keys and environment fallback"
        description="Managed keys work with the `X-Inventory-Token` header on the Ansible inventory endpoint. The legacy `.env` inventory token still works as a fallback."
      />

      <Divider />

      <Table<InventoryApiKey>
        rowKey="id"
        loading={keysQuery.isLoading}
        dataSource={sortedKeys}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Prefix", dataIndex: "key_prefix", render: (value: string) => <Text code>{value}…</Text> },
          {
            title: "Permissions",
            dataIndex: "permissions",
            render: (permissions: InventoryApiKeyPermission[]) => (
              <Space wrap>
                {permissions.map((permission) => (
                  <Tag key={permission} color="blue">{permission}</Tag>
                ))}
              </Space>
            ),
          },
          {
            title: "Status",
            render: (_: unknown, item) => item.is_active ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>,
          },
          {
            title: "Last Used",
            dataIndex: "last_used_at",
            render: (value: string | null) => value ? new Date(value).toLocaleString() : "Never",
          },
          {
            title: "Created",
            dataIndex: "created_at",
            render: (value: string) => new Date(value).toLocaleString(),
          },
          {
            title: "Actions",
            render: (_: unknown, item) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(item)} />
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={rotateMutation.isPending}
                  onClick={() => rotateMutation.mutate(item.id)}
                />
                <Popconfirm title="Delete this API key?" onConfirm={() => deleteMutation.mutate(item.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        expandable={{
          expandedRowRender: (item) => (
            <Paragraph style={{ marginBottom: 0 }}>
              {item.description || "No description"}
            </Paragraph>
          ),
          rowExpandable: (item) => Boolean(item.description),
        }}
      />

      <Modal
        title={editing ? "Edit Inventory API Key" : "Create Inventory API Key"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form<FormValues> form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: "Name is required" }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            label="Permissions"
            name="permissions"
            rules={[{ required: true, message: "Select at least one permission" }]}
          >
            <Select
              mode="multiple"
              options={PERMISSION_OPTIONS}
            />
          </Form.Item>
          <Form.Item label="Active" name="is_active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Inventory API Key"
        open={!!revealedSecret}
        footer={null}
        onCancel={() => setRevealedSecret(null)}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Alert
            type="warning"
            showIcon
            message="Copy this key now"
            description="The raw API key is only shown once after create or rotate. It is not retrievable later."
          />
          <Input.Password readOnly value={revealedSecret ?? ""} iconRender={() => <KeyOutlined />} />
          <Button
            icon={<CopyOutlined />}
            onClick={async () => {
              if (!revealedSecret) return;
              await navigator.clipboard.writeText(revealedSecret);
              message.success("Inventory API key copied.");
            }}
          >
            Copy Key
          </Button>
        </Space>
      </Modal>
    </div>
  );
}
