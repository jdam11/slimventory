import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  deleteBackup,
  downloadBackup,
  getBackupConfig,
  listBackupHistory,
  restoreBackup,
  triggerBackup,
  updateBackupConfig,
  type BackupConfigInput,
  type BackupHistory,
} from "../api/backup";
import { useAuth } from "../store/AuthContext";

const { Title, Text } = Typography;

const CRON_HELP = "Cron format: minute hour day-of-month month day-of-week";

function isLikelyCron(value: string): boolean {
  return value.trim().split(/\s+/).length === 5;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(d: string | null): string {
  if (!d) return "-";
  return new Date(d + "Z").toLocaleString();
}

export default function BackupPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();

  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupHistory | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");

  const configQuery = useQuery({
    queryKey: ["backups", "config"],
    queryFn: getBackupConfig,
  });

  const [configForm] = Form.useForm<BackupConfigInput>();

  const updateConfigMutation = useMutation({
    mutationFn: updateBackupConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backups", "config"] });
      message.success("Backup configuration updated");
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || "Failed to update config");
    },
  });

  const historyQuery = useQuery({
    queryKey: ["backups", "history"],
    queryFn: () => listBackupHistory(),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.items?.some((i) => i.status === "running")) return 3000;
      return false;
    },
  });

  const triggerMutation = useMutation({
    mutationFn: triggerBackup,
    onSuccess: () => {
      message.success("Backup started");
      qc.invalidateQueries({ queryKey: ["backups", "history"] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || "Failed to trigger backup");
    },
  });

  const restoreMutation = useMutation({
    mutationFn: restoreBackup,
    onSuccess: (data) => {
      message.success(data.detail || "Restore completed");
      setRestoreModalOpen(false);
      setRestoreTarget(null);
      setRestoreConfirmText("");
      qc.invalidateQueries({ queryKey: ["backups", "history"] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || "Restore failed");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBackup,
    onSuccess: () => {
      message.success("Backup deleted");
      qc.invalidateQueries({ queryKey: ["backups", "history"] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || "Failed to delete backup");
    },
  });

  if (!isAdmin) {
    return <Text type="danger">Admin access required.</Text>;
  }

  const columns: ColumnsType<BackupHistory> = [
    {
      title: "Filename",
      dataIndex: "filename",
      key: "filename",
      ellipsis: true,
    },
    {
      title: "Size",
      dataIndex: "size_bytes",
      key: "size_bytes",
      width: 100,
      render: (v: number) => formatBytes(v),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (v: string) => {
        const colorMap: Record<string, string> = {
          completed: "green",
          running: "blue",
          failed: "red",
        };
        return <Tag color={colorMap[v] || "default"}>{v}</Tag>;
      },
    },
    {
      title: "Trigger",
      dataIndex: "trigger_source",
      key: "trigger_source",
      width: 100,
    },
    {
      title: "Created By",
      dataIndex: "created_by",
      key: "created_by",
      width: 110,
      render: (v: string | null) => v || "-",
    },
    {
      title: "Started",
      dataIndex: "started_at",
      key: "started_at",
      width: 180,
      render: formatDate,
    },
    {
      title: "Completed",
      dataIndex: "completed_at",
      key: "completed_at",
      width: 180,
      render: formatDate,
    },
    {
      title: "Actions",
      key: "actions",
      width: 150,
      render: (_: unknown, record: BackupHistory) => (
        <Space size="small">
          <Tooltip title="Download">
            <Button
              type="text"
              size="small"
              icon={<CloudDownloadOutlined />}
              disabled={record.status !== "completed"}
              onClick={() => downloadBackup(record.id, record.filename)}
            />
          </Tooltip>
          <Tooltip title="Restore">
            <Button
              type="text"
              size="small"
              icon={<UndoOutlined />}
              disabled={record.status !== "completed"}
              onClick={() => {
                setRestoreTarget(record);
                setRestoreConfirmText("");
                setRestoreModalOpen(true);
              }}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this backup?"
            onConfirm={() => deleteMutation.mutate(record.id)}
          >
            <Tooltip title="Delete">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={record.status === "running"}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // Error column for failed backups
  const expandedRowRender = (record: BackupHistory) => {
    if (!record.error_message) return null;
    return <Text type="danger">{record.error_message}</Text>;
  };

  return (
    <div>
      <Title level={3}>Database Backups</Title>

      {/* ── Configuration Card ───────────────────────────── */}
      <Card
        title="Backup Schedule"
        style={{ marginBottom: 24 }}
        loading={configQuery.isLoading}
        extra={
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={triggerMutation.isPending}
            onClick={() => triggerMutation.mutate()}
          >
            Backup Now
          </Button>
        }
      >
        {configQuery.data && (
          <Form
            form={configForm}
            layout="inline"
            initialValues={{
              schedule_enabled: configQuery.data.schedule_enabled,
              cron_expression: configQuery.data.cron_expression,
              timezone: configQuery.data.timezone,
              retention_count: configQuery.data.retention_count,
            }}
            onFinish={(values) => updateConfigMutation.mutate(values)}
            style={{ flexWrap: "wrap", gap: 12 }}
          >
            <Form.Item name="schedule_enabled" label="Enabled" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name="cron_expression"
              label="Schedule"
              tooltip={CRON_HELP}
              rules={[
                { required: true, message: "Required" },
                {
                  validator: (_, v) =>
                    isLikelyCron(v) ? Promise.resolve() : Promise.reject("Must be a valid cron expression"),
                },
              ]}
            >
              <Input style={{ width: 180 }} placeholder="0 2 * * *" />
            </Form.Item>
            <Form.Item name="timezone" label="Timezone">
              <Input style={{ width: 140 }} />
            </Form.Item>
            <Form.Item
              name="retention_count"
              label="Keep"
              tooltip="Maximum number of backups to retain"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={100} style={{ width: 80 }} />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={updateConfigMutation.isPending}
              >
                Save
              </Button>
            </Form.Item>
          </Form>
        )}
      </Card>

      {/* ── History Table ────────────────────────────────── */}
      <Card title="Backup History">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={historyQuery.data?.items || []}
          loading={historyQuery.isLoading}
          pagination={{ pageSize: 20 }}
          size="small"
          expandable={{
            expandedRowRender,
            rowExpandable: (record) => !!record.error_message,
          }}
        />
      </Card>

      {/* ── Restore Confirmation Modal ───────────────────── */}
      <Modal
        title="Confirm Database Restore"
        open={restoreModalOpen}
        onCancel={() => {
          setRestoreModalOpen(false);
          setRestoreTarget(null);
          setRestoreConfirmText("");
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setRestoreModalOpen(false);
              setRestoreTarget(null);
              setRestoreConfirmText("");
            }}
          >
            Cancel
          </Button>,
          <Button
            key="restore"
            type="primary"
            danger
            loading={restoreMutation.isPending}
            disabled={restoreConfirmText !== "RESTORE"}
            onClick={() => {
              if (restoreTarget) {
                restoreMutation.mutate(restoreTarget.id);
              }
            }}
          >
            Restore
          </Button>,
        ]}
      >
        <p>
          This will <Text strong type="danger">overwrite the current database</Text> with
          the backup:
        </p>
        <p>
          <Text code>{restoreTarget?.filename}</Text>
        </p>
        <p>
          Type <Text strong>RESTORE</Text> to confirm:
        </p>
        <Input
          value={restoreConfirmText}
          onChange={(e) => setRestoreConfirmText(e.target.value)}
          placeholder="Type RESTORE to confirm"
        />
      </Modal>
    </div>
  );
}
