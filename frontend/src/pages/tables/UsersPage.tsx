import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "../../api/client";
import { useAuth } from "../../store/AuthContext";
import type { User } from "../../types";

const { Title } = Typography;

const ROLE_OPTIONS = [
  { value: "admin", label: "admin" },
  { value: "readonly", label: "readonly" },
];

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["/auth/users"],
    queryFn: () => api.get<User[]>("/auth/users").then((r) => r.data),
    enabled: isAdmin,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/auth/users"] });

  const createMut = useMutation({
    mutationFn: (vals: unknown) => api.post("/auth/users", vals),
    onSuccess: () => { invalidate(); closeModal(); message.success("User created"); },
    onError: (e: unknown) => message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Error"),
  });

  const updateMut = useMutation({
    mutationFn: (vals: Record<string, unknown>) =>
      api.patch(`/auth/users/${editing!.id}`, vals),
    onSuccess: () => { invalidate(); closeModal(); message.success("User updated"); },
    onError: (e: unknown) => message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Error"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/auth/users/${id}`),
    onSuccess: () => { invalidate(); message.success("User deleted"); },
    onError: (e: unknown) => message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Error"),
  });

  function openCreate() { setEditing(null); form.resetFields(); setModalOpen(true); }
  function openEdit(u: User) { setEditing(u); form.setFieldsValue(u); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditing(null); form.resetFields(); }

  function handleSubmit() {
    form.validateFields().then((vals) => {
      const clean = Object.fromEntries(
        Object.entries(vals).filter(([, v]) => v !== undefined && v !== "")
      );
      editing ? updateMut.mutate(clean) : createMut.mutate(clean);
    });
  }

  const COLUMNS = [
    { title: "ID", dataIndex: "id", key: "id", width: 70 },
    { title: "Username", dataIndex: "username", key: "username", width: 180 },
    { title: "Email", dataIndex: "email", key: "email" },
    { title: "Role", dataIndex: "role", key: "role", width: 100, render: (v: string) => <Tag color={v === "admin" ? "gold" : "default"}>{v}</Tag> },
    { title: "Active", dataIndex: "is_active", key: "active", width: 80, render: (v: boolean) => <Tag color={v ? "green" : "red"}>{v ? "Yes" : "No"}</Tag> },
    {
      title: "Actions",
      key: "actions",
      width: 110,
      render: (_: unknown, u: User) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(u)} disabled={!isAdmin} />
          <Popconfirm
            title="Delete this user?"
            disabled={!isAdmin || u.id === currentUser?.id}
            onConfirm={() => deleteMut.mutate(u.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} disabled={!isAdmin || u.id === currentUser?.id} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (!isAdmin) {
    return <Typography.Text type="secondary">User management is restricted to admins.</Typography.Text>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Users</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Add</Button>
        </Space>
      </div>

      <Table<User>
        dataSource={data ?? []}
        rowKey="id"
        columns={COLUMNS}
        loading={isFetching}
        size="small"
        onRow={(record) => ({
          onDoubleClick: () => {
            if (isAdmin) {
              openEdit(record);
            }
          },
          style: { cursor: isAdmin ? "pointer" : "default" },
        })}
      />

      <Modal
        title={editing ? "Edit User" : "New User"}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editing && (
            <>
              <Form.Item name="username" label="Username" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="password" label="Password" rules={[{ required: true }, { min: 8, message: "Min 8 characters" }]}>
                <Input.Password />
              </Form.Item>
            </>
          )}
          <Form.Item name="email" label="Email">
            <Input type="email" />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: !editing }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          {editing && (
            <Form.Item name="is_active" label="Active">
              <Select options={[{ value: true, label: "Yes" }, { value: false, label: "No" }]} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
