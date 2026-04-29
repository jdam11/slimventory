import {
  ApartmentOutlined,
  ApiOutlined,
  ArrowLeftOutlined,
  ClusterOutlined,
  CopyOutlined,
  DatabaseOutlined,
  ExpandOutlined,
  NodeIndexOutlined,
  RadarChartOutlined,
  SearchOutlined,
  ShrinkOutlined,
} from "@ant-design/icons";
import { Alert, Button, Empty, Grid, Input, Space, Table, Tag, Tree, Typography, message, theme as antdTheme } from "antd";
import type { DataNode } from "antd/es/tree";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import InventoryHostVarsPanel from "../components/InventoryHostVarsPanel";
import { useTheme } from "../store/ThemeContext";
import { getExtras } from "../theme";
import {
  buildInventoryTreeData,
  findFirstHostKeyByInventoryId,
  findInventoryNodeByKey,
  flattenInventoryHosts,
  getExpandedGroupKeys,
  getInventoryHierarchyStats,
  type InventoryHierarchyGroup,
  type InventoryHierarchyHostRow,
  type InventoryHierarchyHost,
  parseInventoryHierarchy,
} from "../utils/inventoryHierarchy";

const { Title, Text, Paragraph } = Typography;
const { Search } = Input;
const { useBreakpoint } = Grid;

interface InventoryExportResponse {
  _meta?: {
    hostvars?: Record<string, Record<string, unknown>>;
  };
  [key: string]: unknown;
}

function copyText(value: string, successMessage: string) {
  return navigator.clipboard.writeText(value).then(() => {
    message.success(successMessage);
  });
}

export default function InventoryHierarchyPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { mode, themeName } = useTheme();
  const extras = getExtras(themeName, mode);
  const { token } = antdTheme.useToken();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;

  const requestedHostId = Number(searchParams.get("host") ?? "");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>("group:all");
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const inventoryQuery = useQuery({
    queryKey: ["/inventory/ansible", "hierarchy"],
    queryFn: () => api.get<InventoryExportResponse>("/inventory/ansible").then((response) => response.data),
  });

  const rootGroup = useMemo(() => parseInventoryHierarchy(inventoryQuery.data), [inventoryQuery.data]);

  useEffect(() => {
    if (!rootGroup) return;
    if (requestedHostId > 0) {
      const hostKey = findFirstHostKeyByInventoryId(rootGroup, requestedHostId);
      if (hostKey) {
        setSelectedKey(hostKey);
        setExpandedKeys(getExpandedGroupKeys(rootGroup));
        return;
      }
    }
    setSelectedKey(rootGroup.key);
    setExpandedKeys([rootGroup.key]);
  }, [requestedHostId, rootGroup]);

  const selectedNode = useMemo(() => {
    if (!rootGroup) return null;
    return findInventoryNodeByKey(rootGroup, selectedKey);
  }, [rootGroup, selectedKey]);

  const selectedGroup = useMemo(() => {
    if (!rootGroup || !selectedNode) return rootGroup;
    if (selectedNode.type === "group") return selectedNode.group;
    const parentKey = `group:${selectedNode.host.parentGroupPath.join("/")}`;
    const parentNode = findInventoryNodeByKey(rootGroup, parentKey);
    return parentNode?.type === "group" ? parentNode.group : rootGroup;
  }, [rootGroup, selectedNode]);

  useEffect(() => {
    if (!selectedGroup || !search.trim()) return;
    setExpandedKeys(getExpandedGroupKeys(selectedGroup));
  }, [selectedGroup, search]);

  const hostRows = useMemo(() => {
    if (!rootGroup || !selectedGroup) return [];
    const needle = search.trim().toLowerCase();
    const rows = selectedNode?.type === "host"
      ? [{
          key: selectedNode.host.key,
          selectionKey: selectedNode.host.key,
          name: selectedNode.host.name,
          groupPath: selectedNode.host.parentGroupPath.join(" / "),
          inventoryId: selectedNode.host.inventoryId,
          vars: selectedNode.host.vars,
        }]
      : flattenInventoryHosts(selectedGroup);
    return rows.filter((row) => {
      if (!needle) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        row.groupPath.toLowerCase().includes(needle) ||
        Object.keys(row.vars).some((key) => key.toLowerCase().includes(needle)) ||
        Object.values(row.vars).some((value) => String(value).toLowerCase().includes(needle))
      );
    });
  }, [rootGroup, search, selectedGroup, selectedNode]);

  const stats = useMemo(() => {
    if (!rootGroup || !selectedGroup) {
      return { groups: 0, hostRows: 0, uniqueHosts: 0, directHosts: 0 };
    }
    const rows = flattenInventoryHosts(selectedGroup);
    const scopeStats = getInventoryHierarchyStats(selectedGroup);
    return {
      groups: scopeStats.groups,
      directHosts: scopeStats.directHosts,
      hostRows: rows.length,
      uniqueHosts: new Set(rows.map((row) => row.inventoryId ?? row.name)).size,
    };
  }, [rootGroup, selectedGroup]);

  const selectedHostId = selectedNode?.type === "host" ? selectedNode.host.inventoryId : null;

  const scopedTreeData = useMemo(() => {
    if (!selectedGroup) return [];

    const renderGroupTitle = (group: InventoryHierarchyGroup): DataNode["title"] => {
      const scopeStats = getInventoryHierarchyStats(group);
      return (
        <Space size={8}>
          <ApartmentOutlined />
          <span>{group.name}</span>
          <Tag>{scopeStats.totalHosts} hosts</Tag>
          <Tag>{group.children.length} children</Tag>
        </Space>
      );
    };

    const renderHostTitle = (host: InventoryHierarchyHost): DataNode["title"] => (
      <Space size={8}>
        <DatabaseOutlined />
        <span>{host.name}</span>
        {host.inventoryId ? <Tag color="blue">#{host.inventoryId}</Tag> : null}
      </Space>
    );

    return buildInventoryTreeData(selectedGroup, search, renderGroupTitle, renderHostTitle);
  }, [search, selectedGroup]);

  const copySelection = async () => {
    if (!selectedNode) return;
    const payload = selectedNode.type === "group" ? selectedNode.group : selectedNode.host;
    await copyText(JSON.stringify(payload, null, 2), "Selection copied");
  };

  return (
    <div
      className="inventory-hierarchy-page"
      style={{
        background: extras.pageGradient,
        minHeight: "100%",
        borderRadius: 24,
        padding: isMobile ? 16 : 24,
      }}
    >
      <div
        className="inventory-explorer-hero inventory-hierarchy-hero"
        style={{
          boxShadow: extras.cardGlow,
          background: `linear-gradient(135deg, ${extras.accentSurface} 0%, ${token.colorBgContainer} 100%)`,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div>
          <Space size={10} align="center">
            <ClusterOutlined style={{ fontSize: 22, color: token.colorPrimary }} />
            <Title level={2} style={{ margin: 0 }}>
              Inventory Hierarchy
            </Title>
          </Space>
          <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 6, maxWidth: 680 }}>
            Inspect the live Ansible inventory as a navigable group tree, then zoom into the selected scope instead of carrying the whole hierarchy on screen.
          </Paragraph>
        </div>
        <div className="inventory-explorer-hero-stats">
          <div className="inventory-explorer-stat-tile">
            <Text type="secondary">Groups</Text>
            <Title level={3}>{stats.groups}</Title>
          </div>
          <div className="inventory-explorer-stat-tile">
            <Text type="secondary">Scoped Hosts</Text>
            <Title level={3}>{stats.hostRows}</Title>
          </div>
          <div className="inventory-explorer-stat-tile">
            <Text type="secondary">Direct Hosts</Text>
            <Title level={3}>{stats.directHosts}</Title>
          </div>
        </div>
      </div>

      <div className="inventory-hierarchy-actions">
        <Search
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Search groups, hosts, vars"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ maxWidth: 320 }}
        />
        <Space wrap>
          <Button
            icon={<ArrowLeftOutlined />}
            disabled={!selectedNode || !rootGroup || selectedGroup?.key === rootGroup.key}
            onClick={() => {
              if (!rootGroup || !selectedGroup) return;
              if (selectedNode?.type === "host") {
                setSelectedKey(selectedGroup.key);
                return;
              }
              const parentPath = selectedGroup.path.slice(0, -1);
              const parentKey = parentPath.length ? `group:${parentPath.join("/")}` : rootGroup.key;
              setSelectedKey(parentKey);
              if (parentKey === rootGroup.key) {
                setSearchParams({}, { replace: true });
              }
            }}
          >
            Zoom Out
          </Button>
          <Button icon={<ExpandOutlined />} onClick={() => selectedGroup && setExpandedKeys(getExpandedGroupKeys(selectedGroup))}>
            Expand All
          </Button>
          <Button icon={<ShrinkOutlined />} onClick={() => setExpandedKeys(selectedGroup ? [selectedGroup.key] : [])}>
            Collapse All
          </Button>
          <Button icon={<CopyOutlined />} disabled={!selectedNode} onClick={() => void copySelection()}>
            Copy Selection
          </Button>
          <Button icon={<ApiOutlined />} onClick={() => window.open("/api/inventory/ansible", "_blank", "noopener,noreferrer")}>
            Export Inventory
          </Button>
          <Button
            icon={<RadarChartOutlined />}
            disabled={!selectedHostId}
            onClick={() => {
              if (!selectedHostId) return;
              navigate(`/inventory/explorer?host=${selectedHostId}`);
            }}
          >
            Open In Explorer
          </Button>
        </Space>
      </div>

      <div className="inventory-hierarchy-layout">
        <section
          className="inventory-explorer-card inventory-hierarchy-tree-card"
          style={{
            boxShadow: extras.cardGlow,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <div className="inventory-explorer-panel-head">
            <div>
              <Text type="secondary">Structure</Text>
              <Title level={4} style={{ margin: "4px 0 0" }}>
                {selectedNode?.type === "host" ? "Parent Group Scope" : "Focused Scope"}
              </Title>
            </div>
            <Space wrap>
              <Tag color="processing">Live Inventory</Tag>
              {selectedGroup ? <Tag icon={<NodeIndexOutlined />}>{selectedGroup.path.join(" / ")}</Tag> : null}
            </Space>
          </div>

          {inventoryQuery.isLoading ? (
            <div className="inventory-explorer-loading">
              <span>Loading inventory...</span>
            </div>
          ) : inventoryQuery.isError ? (
            <Alert
              type="error"
              showIcon
              message={(inventoryQuery.error as Error).message || "Failed to load inventory export."}
            />
          ) : !rootGroup ? (
            <Empty description="The live inventory export could not be parsed." />
          ) : (
            <Tree
              treeData={scopedTreeData}
              selectedKeys={selectedKey ? [selectedKey] : []}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys as string[])}
              onSelect={(keys) => {
                const nextKey = keys[0];
                if (typeof nextKey === "string") {
                  setSelectedKey(nextKey);
                  const nextNode = findInventoryNodeByKey(rootGroup, nextKey);
                  if (nextNode?.type === "host" && nextNode.host.inventoryId) {
                    setSearchParams({ host: String(nextNode.host.inventoryId) }, { replace: true });
                  } else {
                    setSearchParams({}, { replace: true });
                  }
                }
              }}
              className="inventory-hierarchy-tree"
            />
          )}

          <div
            className="inventory-explorer-card inventory-hierarchy-selection-card"
            style={{
              boxShadow: extras.cardGlow,
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
              marginTop: 14,
            }}
          >
            <div className="inventory-explorer-panel-head">
              <div>
                <Text type="secondary">Selection</Text>
                <Title level={4} style={{ margin: "4px 0 0" }}>
                  {selectedNode?.type === "host" ? "Parent Group Scope" : selectedNode?.type === "group" ? "Group Details" : "No Selection"}
                </Title>
              </div>
              {selectedNode?.type === "host" && selectedHostId ? <Tag color="blue">Host #{selectedHostId}</Tag> : null}
            </div>

            {!selectedNode ? (
              <Empty description="Select a group or host from the tree." />
            ) : selectedNode.type === "group" ? (
              <div className="inventory-hierarchy-selection-body">
                <div className="inventory-hierarchy-path">
                  <Text type="secondary">Path</Text>
                  <div className="inventory-hierarchy-path-value">{selectedNode.group.path.join(" / ")}</div>
                </div>
                <Space wrap>
                  <Tag color="blue">{getInventoryHierarchyStats(selectedNode.group).totalHosts} descendant hosts</Tag>
                  <Tag color="cyan">{selectedNode.group.hosts.length} direct hosts</Tag>
                  <Tag color="purple">{selectedNode.group.children.length} child groups</Tag>
                </Space>
                {selectedNode.group.children.length > 0 ? (
                  <Space wrap>
                    {selectedNode.group.children.map((child) => (
                      <Tag
                        key={child.key}
                        color="geekblue"
                        onClick={() => setSelectedKey(child.key)}
                        style={{ cursor: "pointer" }}
                      >
                        {child.name}
                      </Tag>
                    ))}
                  </Space>
                ) : null}
                <div className="inventory-hierarchy-code-block">
                  <pre>{JSON.stringify(selectedNode.group.vars ?? {}, null, 2)}</pre>
                </div>
              </div>
            ) : (
              <div className="inventory-hierarchy-selection-body">
                <div className="inventory-hierarchy-path">
                  <Text type="secondary">Parent Group Path</Text>
                  <div className="inventory-hierarchy-path-value">{selectedNode.host.parentGroupPath.join(" / ")}</div>
                </div>
                <Space wrap>
                  {selectedNode.host.inventoryId ? <Tag color="blue">inventory_id: {selectedNode.host.inventoryId}</Tag> : null}
                  {selectedNode.host.vars.ansible_host ? <Tag color="cyan">{String(selectedNode.host.vars.ansible_host)}</Tag> : null}
                  <Tag color="purple">Scoped to this host</Tag>
                </Space>
                <div className="inventory-hierarchy-host-detail-grid">
                  <div className="inventory-hierarchy-host-detail-card">
                    <Text type="secondary">Host</Text>
                    <div className="inventory-hierarchy-path-value">{selectedNode.host.name}</div>
                  </div>
                  <div className="inventory-hierarchy-host-detail-card">
                    <Text type="secondary">Inventory ID</Text>
                    <div className="inventory-hierarchy-path-value">{selectedNode.host.inventoryId ?? "not set"}</div>
                  </div>
                  <div className="inventory-hierarchy-host-detail-card">
                    <Text type="secondary">Ansible Host</Text>
                    <div className="inventory-hierarchy-path-value">{String(selectedNode.host.vars.ansible_host ?? "not set")}</div>
                  </div>
                </div>
                <div className="inventory-hierarchy-code-block">
                  <pre>{JSON.stringify(selectedNode.host.vars ?? {}, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="inventory-hierarchy-detail-stack">
          <InventoryHostVarsPanel hostId={selectedHostId} className="inventory-hierarchy-hostvar-panels" compact />
        </section>
      </div>

      <div
        className="inventory-explorer-card inventory-hierarchy-hosts-card"
        style={{
          boxShadow: extras.cardGlow,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div className="inventory-explorer-panel-head">
          <div>
            <Text type="secondary">Inventory Surface</Text>
            <Title level={4} style={{ margin: "4px 0 0" }}>
              {selectedNode?.type === "host" ? "Host Spotlight" : "Scoped Hosts"}
            </Title>
          </div>
          <Text type="secondary">
            {selectedNode?.type === "host"
              ? "Showing only the selected host."
              : "Showing hosts in the selected group's subtree."}
          </Text>
        </div>

        <Table<InventoryHierarchyHostRow>
          rowKey="key"
          size="small"
          dataSource={hostRows}
          pagination={{ pageSize: 6, size: "small" }}
          onRow={(record) => ({
            onClick: () => {
              setSelectedKey(record.selectionKey);
              if (record.inventoryId) {
                setSearchParams({ host: String(record.inventoryId) }, { replace: true });
              }
            },
          })}
          columns={[
            {
              title: "Host",
              dataIndex: "name",
              key: "name",
              render: (value: string, record: { inventoryId: number | null }) => (
                <Space size={8}>
                  <Text code>{value}</Text>
                  {record.inventoryId ? <Tag color="blue">#{record.inventoryId}</Tag> : null}
                </Space>
              ),
            },
            {
              title: "Group Path",
              dataIndex: "groupPath",
              key: "groupPath",
            },
            {
              title: "Vars",
              dataIndex: "vars",
              key: "vars",
              render: (vars: Record<string, unknown>) => (
                <Space wrap>
                  {Object.entries(vars).slice(0, 3).map(([key, value]) => (
                    <Tag key={key}>{key}: {String(value)}</Tag>
                  ))}
                  {Object.keys(vars).length > 3 ? <Tag>+{Object.keys(vars).length - 3} more</Tag> : null}
                </Space>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
