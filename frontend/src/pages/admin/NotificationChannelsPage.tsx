import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { BellOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SendOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createNotificationChannel,
  deleteNotificationChannel,
  getNotificationEventKeys,
  listNotificationChannels,
  testNotificationChannel,
  updateNotificationChannel,
} from "../../api/notifications";
import type { NotificationChannel, NotificationType } from "../../types";

const { Title, Text } = Typography;

const TYPE_OPTIONS: { value: NotificationType; label: string }[] = [
  { value: "ntfy", label: "ntfy" },
  { value: "gotify", label: "Gotify" },
  { value: "discord", label: "Discord" },
  { value: "slack", label: "Slack" },
  { value: "generic_webhook", label: "Generic webhook" },
];

interface FormValues {
  name: string;
  type: NotificationType;
  url: string;
  events: string[];
  enabled: boolean;
  secret?: string;
}

export default function NotificationChannelsPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [editing, setEditing] = useState<NotificationChannel | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const channelsQuery = useQuery({
    queryKey: ["/notification-channels"],
    queryFn: listNotificationChannels,
  });
  const eventsQuery = useQuery({
    queryKey: ["/notification-channels/event-keys"],
    queryFn: getNotificationEventKeys,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/notification-channels"] });

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = { ...values, secret: values.secret || undefined };
      return editing
        ? updateNotificationChannel(editing.id, payload)
        : createNotificationChannel(payload);
    },
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      message.success("Channel saved");
    },
    onError: () => message.error("Failed to save channel"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNotificationChannel,
    onSuccess: () => {
      invalidate();
      message.success("Channel deleted");
    },
    onError: () => message.error("Failed to delete channel"),
  });

  const testMutation = useMutation({
    mutationFn: testNotificationChannel,
    onSuccess: (result) =>
      result.ok ? message.success(`Test delivered (${result.detail})`) : message.error(`Test failed: ${result.detail}`),
    onError: () => message.error("Test request failed"),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: "ntfy", enabled: true, events: [] });
    setModalOpen(true);
  };

  const openEdit = (channel: NotificationChannel) => {
    setEditing(channel);
    form.resetFields();
    form.setFieldsValue({
      name: channel.name,
      type: channel.type,
      url: channel.url,
      events: channel.events,
      enabled: channel.enabled,
      secret: undefined,
    });
    setModalOpen(true);
  };

  const eventOptions = (eventsQuery.data ?? []).map((e) => ({ value: e, label: e }));

  const columns: ColumnsType<NotificationChannel> = [
    { title: "Name", dataIndex: "name" },
    { title: "Type", dataIndex: "type", render: (t: string) => <Tag>{t}</Tag> },
    { title: "URL", dataIndex: "url", ellipsis: true },
    {
      title: "Events",
      dataIndex: "events",
      render: (events: string[]) =>
        events.length ? events.map((e) => <Tag key={e}>{e}</Tag>) : <Text type="secondary">none</Text>,
    },
    {
      title: "Enabled",
      dataIndex: "enabled",
      width: 90,
      render: (v: boolean) => (v ? <Tag color="green">on</Tag> : <Tag>off</Tag>),
    },
    {
      title: "Secret",
      dataIndex: "has_secret",
      width: 90,
      render: (v: boolean) => (v ? <Tag color="blue">set</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: "Actions",
      key: "actions",
      width: 200,
      render: (_v, row) => (
        <Space>
          <Button
            size="small"
            icon={<SendOutlined />}
            loading={testMutation.isPending && testMutation.variables === row.id}
            onClick={() => testMutation.mutate(row.id)}
          >
            Test
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <Popconfirm title="Delete this channel?" onConfirm={() => deleteMutation.mutate(row.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <Title level={4} style={{ marginBottom: 4 }}>
              <BellOutlined /> Notification Channels
            </Title>
            <Text type="secondary">Send ntfy, Gotify, Discord, Slack, or webhook alerts on key events.</Text>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add Channel
          </Button>
        </div>

        {channelsQuery.error && <Alert type="error" showIcon message="Failed to load channels" />}

        <Table
          rowKey="id"
          size="small"
          loading={channelsQuery.isLoading}
          dataSource={channelsQuery.data?.items ?? []}
          columns={columns}
          pagination={false}
        />
      </Space>

      <Modal
        title={editing ? "Edit Channel" : "Add Channel"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. homelab-ntfy" />
          </Form.Item>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select options={TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="url" label="URL" rules={[{ required: true }]}>
            <Input placeholder="https://ntfy.sh/my-topic" />
          </Form.Item>
          <Form.Item name="events" label="Subscribed events">
            <Select mode="multiple" allowClear options={eventOptions} placeholder="Select events" />
          </Form.Item>
          <Form.Item
            name="secret"
            label={editing && editing.has_secret ? "Secret / token (leave blank to keep current)" : "Secret / token (optional)"}
          >
            <Input.Password placeholder="API key or bearer token" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="enabled" label="Enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
