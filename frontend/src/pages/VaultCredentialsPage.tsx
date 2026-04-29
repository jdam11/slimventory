import { useState } from "react";
import { Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createVaultCredential,
  deleteVaultCredential,
  listVaultCredentials,
  updateVaultCredential,
} from "../api/job_templates";
import { useAuth } from "../store/AuthContext";
import type { VaultCredential } from "../types";

const { Title } = Typography;

export default function VaultCredentialsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VaultCredential | null>(null);
  const [form] = Form.useForm<{ name: string; vault_password?: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["/vault-credentials"],
    queryFn: () => listVaultCredentials(0, 200),
  });

  const createMutation = useMutation({
    mutationFn: createVaultCredential,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/vault-credentials"] });
      message.success("Vault credential created.");
      setOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: { name?: string; vault_password?: string } }) =>
      updateVaultCredential(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/vault-credentials"] });
      message.success("Vault credential updated.");
      setOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteVaultCredential,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/vault-credentials"] });
      message.success("Vault credential deleted.");
    },
  });

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  }

  function openEdit(item: VaultCredential) {
    setEditing(item);
    form.setFieldsValue({ name: item.name, vault_password: "" });
    setOpen(true);
  }

  function submit(values: { name: string; vault_password?: string }) {
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload: values });
    } else {
      createMutation.mutate(values);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Vault Credentials</Title>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add Credential
          </Button>
        )}
      </div>

      <Table<VaultCredential>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        onRow={(record) => ({
          onDoubleClick: () => {
            if (isAdmin) {
              openEdit(record);
            }
          },
          style: { cursor: isAdmin ? "pointer" : "default" },
        })}
        columns={[
          { title: "Name", dataIndex: "name" },
          {
            title: "Has Password",
            dataIndex: "has_password",
            render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "Yes" : "No"}</Tag>,
          },
          {
            title: "Created",
            dataIndex: "created_at",
            render: (value: string) => new Date(value).toLocaleString(),
          },
          {
            title: "Actions",
            render: (_: unknown, record: VaultCredential) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} disabled={!isAdmin} onClick={() => openEdit(record)} />
                <Popconfirm title="Delete this credential?" onConfirm={() => deleteMutation.mutate(record.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} disabled={!isAdmin} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? "Edit Vault Credential" : "Create Vault Credential"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: "Name is required" }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Vault Password" name="vault_password">
            <Input.Password placeholder={editing?.has_password ? "Leave blank to clear or replace" : "Password"} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
