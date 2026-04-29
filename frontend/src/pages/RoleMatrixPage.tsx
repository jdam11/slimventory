import { PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  Card,
  Empty,
  Grid,
  Input,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
  theme as antdTheme,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  getRoleMatrix,
  toggleRoleAssignment,
} from "../api/role_matrix";
import { useAuth } from "../store/AuthContext";
import type {
  RoleMatrixAssignment,
  RoleMatrixHost,
  RoleMatrixResponse,
  RoleMatrixRole,
} from "../types";

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const QUERY_KEY = ["/role-matrix"] as const;

function matchesFilter(text: string, filter: string): boolean {
  if (!filter) return true;
  return text.toLowerCase().includes(filter.trim().toLowerCase());
}

function priorityFor(
  assignments: RoleMatrixAssignment[],
  hostId: number,
  roleId: number
): number | null {
  const match = assignments.find(
    (a) => a.host_id === hostId && a.role_id === roleId
  );
  return match ? match.priority : null;
}

interface RoleChipProps {
  role: RoleMatrixRole;
  priority: number | null;
  loading: boolean;
  disabled: boolean;
  onToggle: () => void;
}

function RoleChip({ role, priority, loading, disabled, onToggle }: RoleChipProps) {
  const assigned = priority !== null;
  const { token } = antdTheme.useToken();

  const bg = assigned ? token.colorPrimaryBg : "transparent";
  const borderColor = assigned ? token.colorPrimary : token.colorBorder;
  const color = assigned ? token.colorPrimary : token.colorTextSecondary;

  return (
    <Tooltip
      title={
        disabled
          ? "Read-only — admin required to change assignments"
          : assigned
          ? `Priority ${priority}. Tap to remove.`
          : "Tap to assign"
      }
    >
      <span
        onClick={disabled || loading ? undefined : onToggle}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 999,
          background: bg,
          border: `1px solid ${borderColor}`,
          color,
          fontSize: 13,
          fontWeight: assigned ? 600 : 400,
          cursor: disabled ? "not-allowed" : loading ? "progress" : "pointer",
          opacity: loading ? 0.55 : 1,
          whiteSpace: "nowrap",
          userSelect: "none",
        }}
      >
        {assigned ? (
          <span style={{ fontSize: 11, opacity: 0.75 }}>#{priority}</span>
        ) : (
          <PlusOutlined style={{ fontSize: 11 }} />
        )}
        {role.name}
      </span>
    </Tooltip>
  );
}

export default function RoleMatrixPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const { token } = antdTheme.useToken();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [hostFilter, setHostFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getRoleMatrix,
  });

  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set());

  const toggleMut = useMutation({
    mutationFn: toggleRoleAssignment,
    onMutate: ({ host_id, role_id }) => {
      setPendingCells((prev) => {
        const next = new Set(prev);
        next.add(`${host_id}:${role_id}`);
        return next;
      });
    },
    onSuccess: (_res, { host_id, role_id }) => {
      setPendingCells((prev) => {
        const next = new Set(prev);
        next.delete(`${host_id}:${role_id}`);
        return next;
      });
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err, { host_id, role_id }) => {
      setPendingCells((prev) => {
        const next = new Set(prev);
        next.delete(`${host_id}:${role_id}`);
        return next;
      });
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? "Toggle failed";
      message.error(detail);
    },
  });

  const filteredHosts = useMemo(() => {
    if (!data) return [];
    return data.hosts.filter((h) => matchesFilter(h.name, hostFilter));
  }, [data, hostFilter]);

  const filteredRoles = useMemo(() => {
    if (!data) return [];
    return data.roles.filter((r) => matchesFilter(r.name, roleFilter));
  }, [data, roleFilter]);

  const assignments = data?.assignments ?? [];
  const assignmentCount = assignments.length;
  const hostCount = data?.hosts.length ?? 0;
  const roleCount = data?.roles.length ?? 0;

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 64 }}>
        <Spin />
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        type="error"
        message="Failed to load role matrix"
        description={(error as Error).message}
        showIcon
      />
    );
  }

  if (!data || (hostCount === 0 && roleCount === 0)) {
    return (
      <Empty
        description="No hosts or roles yet. Create some from the Hosts and Roles pages, then come back."
        style={{ marginTop: 64 }}
      />
    );
  }

  const filters = (
    <Space wrap size={8} style={{ marginBottom: 16 }}>
      <Input.Search
        placeholder="Filter hosts"
        allowClear
        value={hostFilter}
        onChange={(e) => setHostFilter(e.target.value)}
        style={{ width: 220 }}
      />
      <Input.Search
        placeholder="Filter roles"
        allowClear
        value={roleFilter}
        onChange={(e) => setRoleFilter(e.target.value)}
        style={{ width: 220 }}
      />
      <Tag color="blue">
        {filteredHosts.length} / {hostCount} hosts
      </Tag>
      <Tag color="purple">
        {filteredRoles.length} / {roleCount} roles
      </Tag>
      <Tag>{assignmentCount} assignments</Tag>
    </Space>
  );

  const header = (
    <>
      <Title level={3} style={{ marginBottom: 4 }}>
        Role Matrix
      </Title>
      <Text type="secondary">
        Tap a role chip on a host to assign or unassign. Priority is auto-assigned
        in the order you add roles (lower number = higher precedence).
        {!isAdmin && " Read-only — admin required to make changes."}
      </Text>
    </>
  );

  if (isMobile) {
    return renderMobile({
      header,
      filters,
      filteredHosts,
      filteredRoles,
      assignments,
      pendingCells,
      isAdmin,
      onToggle: (host_id, role_id) => toggleMut.mutate({ host_id, role_id }),
      token,
    });
  }

  return renderDesktop({
    header,
    filters,
    filteredHosts,
    filteredRoles,
    assignments,
    pendingCells,
    isAdmin,
    onToggle: (host_id, role_id) => toggleMut.mutate({ host_id, role_id }),
    token,
  });
}

interface RenderProps {
  header: React.ReactNode;
  filters: React.ReactNode;
  filteredHosts: RoleMatrixHost[];
  filteredRoles: RoleMatrixRole[];
  assignments: RoleMatrixAssignment[];
  pendingCells: Set<string>;
  isAdmin: boolean;
  onToggle: (hostId: number, roleId: number) => void;
  token: ReturnType<typeof antdTheme.useToken>["token"];
}

function renderMobile(props: RenderProps) {
  const {
    header,
    filters,
    filteredHosts,
    filteredRoles,
    assignments,
    pendingCells,
    isAdmin,
    onToggle,
  } = props;

  return (
    <div>
      {header}
      <div style={{ marginTop: 12 }}>{filters}</div>
      {filteredHosts.length === 0 && (
        <Empty description="No hosts match the current filter" />
      )}
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        {filteredHosts.map((host) => {
          const hostAssignments = assignments.filter(
            (a) => a.host_id === host.id
          );
          return (
            <Card
              key={host.id}
              size="small"
              title={
                <Space>
                  <span>{host.name}</span>
                  <Tag>{hostAssignments.length} roles</Tag>
                </Space>
              }
              bodyStyle={{ padding: "8px 12px", overflowX: "auto" }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "nowrap",
                  overflowX: "auto",
                  paddingBottom: 4,
                }}
              >
                {filteredRoles.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    No roles match the current filter
                  </Text>
                ) : (
                  filteredRoles.map((role) => {
                    const priority = priorityFor(assignments, host.id, role.id);
                    const key = `${host.id}:${role.id}`;
                    return (
                      <RoleChip
                        key={role.id}
                        role={role}
                        priority={priority}
                        loading={pendingCells.has(key)}
                        disabled={!isAdmin}
                        onToggle={() => onToggle(host.id, role.id)}
                      />
                    );
                  })
                )}
              </div>
            </Card>
          );
        })}
      </Space>
    </div>
  );
}

function renderDesktop(props: RenderProps) {
  const {
    header,
    filters,
    filteredHosts,
    filteredRoles,
    assignments,
    pendingCells,
    isAdmin,
    onToggle,
    token,
  } = props;

  return (
    <div>
      {header}
      <div style={{ marginTop: 12 }}>{filters}</div>
      {filteredHosts.length === 0 || filteredRoles.length === 0 ? (
        <Empty description="No rows or columns match the current filters" />
      ) : (
        <div
          style={{
            overflowX: "auto",
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadius,
            background: token.colorBgContainer,
          }}
        >
          <table
            style={{
              borderCollapse: "separate",
              borderSpacing: 0,
              width: "100%",
              minWidth: 480,
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky",
                    left: 0,
                    top: 0,
                    zIndex: 2,
                    background: token.colorBgContainer,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    padding: "10px 12px",
                    textAlign: "left",
                    minWidth: 200,
                  }}
                >
                  Host
                </th>
                {filteredRoles.map((role) => (
                  <th
                    key={role.id}
                    style={{
                      padding: "10px 12px",
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                      textAlign: "left",
                      whiteSpace: "nowrap",
                      fontWeight: 500,
                      color: token.colorTextSecondary,
                    }}
                  >
                    {role.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredHosts.map((host, idx) => (
                <tr
                  key={host.id}
                  style={{
                    background:
                      idx % 2 === 0 ? "transparent" : token.colorFillQuaternary,
                  }}
                >
                  <td
                    style={{
                      position: "sticky",
                      left: 0,
                      background:
                        idx % 2 === 0
                          ? token.colorBgContainer
                          : token.colorFillQuaternary,
                      padding: "8px 12px",
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {host.name}
                  </td>
                  {filteredRoles.map((role) => {
                    const priority = priorityFor(assignments, host.id, role.id);
                    const key = `${host.id}:${role.id}`;
                    return (
                      <td
                        key={role.id}
                        style={{
                          padding: "6px 10px",
                          borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        }}
                      >
                        <RoleChip
                          role={role}
                          priority={priority}
                          loading={pendingCells.has(key)}
                          disabled={!isAdmin}
                          onToggle={() => onToggle(host.id, role.id)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
