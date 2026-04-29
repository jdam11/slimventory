import { useState } from "react";
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createGitCredential,
  deleteGitCredential,
  listGitCredentials,
  updateGitCredential,
} from "../api/git";
import { useAuth } from "../store/AuthContext";
import type { GitAuthType, GitCredential } from "../types";

const { Title } = Typography;

interface CredentialFormValues {
  name: string;
  auth_type: GitAuthType;
  https_username?: string;
  https_password?: string;
  ssh_private_key?: string;
}

export default function GitCredentialsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GitCredential | null>(null);
  const [form] = Form.useForm<CredentialFormValues>();
  const authType = Form.useWatch("auth_type", form);

  const { data, isLoading } = useQuery({
    queryKey: ["/git-credentials"],
    queryFn: () => listGitCredentials(0, 200),
  });

  const createMutation = useMutation({
    mutationFn: createGitCredential,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/git-credentials"] });
      message.success("Git credential created.");
      setOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CredentialFormValues> }) =>
      updateGitCredential(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/git-credentials"] });
      qc.invalidateQueries({ queryKey: ["/git-repos"] });
      message.success("Git credential updated.");
      setOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteGitCredential,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/git-credentials"] });
      qc.invalidateQueries({ queryKey: ["/git-repos"] });
      message.success("Git credential deleted.");
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail ?? "Failed to delete credential.");
    },
  });

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ auth_type: "https" });
    setOpen(true);
  }

  function openEdit(item: GitCredential) {
    setEditing(item);
    form.setFieldsValue({
      name: item.name,
      auth_type: item.auth_type,
      https_username: item.https_username ?? undefined,
      https_password: "",
      ssh_private_key: "",
    });
    setOpen(true);
  }

  function submit(values: CredentialFormValues) {
    const payload: Partial<CredentialFormValues> = {
      name: values.name,
      auth_type: values.auth_type,
      https_username: values.auth_type === "https" ? values.https_username || undefined : undefined,
      ...(values.https_password ? { https_password: values.https_password } : {}),
      ...(values.ssh_private_key ? { ssh_private_key: values.ssh_private_key } : {}),
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(payload as CredentialFormValues);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Git Credentials</Title>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add Credential
          </Button>
        )}
      </div>

      <Table<GitCredential>
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
            title: "Auth",
            dataIndex: "auth_type",
            render: (value: GitAuthType) => <Tag>{value === "https" ? "HTTPS" : value === "ssh" ? "SSH Key" : "Public"}</Tag>,
          },
          {
            title: "Username",
            dataIndex: "https_username",
            render: (value: string | null) => value ?? "-",
          },
          {
            title: "Secrets",
            render: (_: unknown, record: GitCredential) => (
              <Space size={4}>
                {record.has_https_password && <Tag color="green">token</Tag>}
                {record.has_ssh_key && <Tag color="blue">key</Tag>}
                {!record.has_https_password && !record.has_ssh_key && <Tag>none</Tag>}
              </Space>
            ),
          },
          {
            title: "Created",
            dataIndex: "created_at",
            render: (value: string) => new Date(value).toLocaleString(),
          },
          {
            title: "Actions",
            render: (_: unknown, record: GitCredential) => (
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
        title={editing ? "Edit Git Credential" : "Create Git Credential"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ auth_type: "https" }}>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: "Name is required" }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Authentication" name="auth_type" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "https", label: "HTTPS (username + token/password)" },
                { value: "ssh", label: "SSH private key" },
                { value: "none", label: "Public (no auth)" },
              ]}
            />
          </Form.Item>
          {authType === "https" && (
            <>
              <Form.Item label="Username" name="https_username">
                <Input placeholder="git" />
              </Form.Item>
              <Form.Item label="Password / Token" name="https_password">
                <Input.Password placeholder={editing?.has_https_password ? "Leave blank to keep existing" : "Token"} />
              </Form.Item>
            </>
          )}
          {authType === "ssh" && (
            <Form.Item label="SSH Private Key" name="ssh_private_key">
              <Input.TextArea
                rows={6}
                placeholder={editing?.has_ssh_key ? "Leave blank to keep existing key" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
