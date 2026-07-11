import { useState } from "react";
import { Alert, Card, Input, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQuery } from "@tanstack/react-query";
import { getAuditLog } from "../../api/audit";
import type { AuditLogEntry, AuditLogQuery } from "../../types";

const { Title, Text } = Typography;

const ACTION_COLORS: Record<string, string> = {
  create: "green",
  update: "blue",
  delete: "red",
};

const METHOD_COLORS: Record<string, string> = {
  POST: "green",
  PUT: "blue",
  PATCH: "blue",
  DELETE: "red",
};

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [action, setAction] = useState<string | undefined>(undefined);

  const query: AuditLogQuery = {
    entity: entity || undefined,
    username: username || undefined,
    action,
    skip: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["/audit", query],
    queryFn: () => getAuditLog(query),
  });

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const columns: ColumnsType<AuditLogEntry> = [
    {
      title: "Time",
      dataIndex: "ts",
      width: 180,
      render: (ts: string) => new Date(ts).toLocaleString(),
    },
    { title: "User", dataIndex: "username", width: 130, render: (u: string | null) => u ?? <Text type="secondary">—</Text> },
    {
      title: "Action",
      dataIndex: "action",
      width: 100,
      render: (a: string | null) => (a ? <Tag color={ACTION_COLORS[a]}>{a}</Tag> : <Text type="secondary">—</Text>),
    },
    { title: "Entity", dataIndex: "entity", width: 150, render: (e: string | null) => e ?? <Text type="secondary">—</Text> },
    { title: "ID", dataIndex: "entity_id", width: 70, render: (id: string | null) => id ?? "—" },
    {
      title: "Method",
      dataIndex: "method",
      width: 90,
      render: (m: string) => <Tag color={METHOD_COLORS[m]}>{m}</Tag>,
    },
    { title: "Path", dataIndex: "path", ellipsis: true },
    { title: "Status", dataIndex: "status_code", width: 80 },
    { title: "IP", dataIndex: "ip", width: 130, render: (ip: string | null) => ip ?? "—" },
  ];

  return (
    <Card>
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>
            Audit Log
          </Title>
          <Text type="secondary">Record of every create, update, and delete made through the API.</Text>
        </div>

        {error && <Alert type="error" showIcon message="Failed to load audit log" />}

        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Filter by entity"
            style={{ width: 200 }}
            onSearch={resetPage(setEntity)}
            onChange={(e) => !e.target.value && resetPage(setEntity)("")}
          />
          <Input.Search
            allowClear
            placeholder="Filter by user"
            style={{ width: 200 }}
            onSearch={resetPage(setUsername)}
            onChange={(e) => !e.target.value && resetPage(setUsername)("")}
          />
          <Select
            allowClear
            placeholder="Action"
            style={{ width: 150 }}
            value={action}
            onChange={resetPage(setAction)}
            options={[
              { value: "create", label: "create" },
              { value: "update", label: "update" },
              { value: "delete", label: "delete" },
            ]}
          />
        </Space>

        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={data?.items ?? []}
          columns={columns}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
        />
      </Space>
    </Card>
  );
}
