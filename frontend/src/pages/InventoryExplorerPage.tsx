import {
  ApiOutlined,
  ClusterOutlined,
  InfoCircleOutlined,
  NodeIndexOutlined,
  PartitionOutlined,
  RadarChartOutlined,
} from "@ant-design/icons";
import { Button, Card, Drawer, Empty, Grid, Select, Space, Spin, Typography, theme as antdTheme } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import { listRecords } from "../api/crud";
import InventoryHostVarsPanel from "../components/InventoryHostVarsPanel";
import type { Host, InventoryExplorerData, InventoryExplorerGroup } from "../types";
import { inventoryExplorerGroupStyle, inventoryExplorerLayerStyle } from "../utils/inventoryExplorerTheme";
import { buildSortedOptions, buildHostOption, filterSelectOption } from "../utils/selectOptions";

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

export default function InventoryExplorerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const { token } = antdTheme.useToken();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const selectedHostId = Number(searchParams.get("host") ?? "");

  const hostsQuery = useQuery({
    queryKey: ["/hosts", "inventory-explorer"],
    queryFn: () => listRecords<Host>("/hosts", 0, 1000),
  });

  const hostOptions = useMemo(
    () => buildSortedOptions(hostsQuery.data?.items ?? [], buildHostOption),
    [hostsQuery.data?.items]
  );

  useEffect(() => {
    if (!selectedHostId && hostOptions.length > 0) {
      setSearchParams({ host: String(hostOptions[0].value) }, { replace: true });
    }
  }, [hostOptions, selectedHostId, setSearchParams]);

  const explorerQuery = useQuery({
    queryKey: ["/inventory/explorer", selectedHostId],
    queryFn: () =>
      api.get<InventoryExplorerData>(`/inventory/hosts/${selectedHostId}/explorer`).then((response) => response.data),
    enabled: Number.isFinite(selectedHostId) && selectedHostId > 0,
  });

  const stats = useMemo(() => {
    const items = explorerQuery.data?.vars ?? [];
    return {
      total: items.length,
      editable: items.filter((item) => item.editable).length,
      overridden: items.filter((item) => item.has_host_override).length,
    };
  }, [explorerQuery.data?.vars]);

  const layerOrder = [
    "base",
    "ansible_defaults",
    "status_defaults",
    "global_role_defaults",
    "host_type_defaults",
    "host_type_role_defaults",
    "host_role_defaults",
    "app_defaults",
    "host_type_overrides",
    "status_overrides",
    "role_overrides",
    "app_overrides",
    "ansible_overrides",
  ];

  const hostDetails = explorerQuery.data ?? null;

  return (
    <div className="inventory-explorer-page">
      <div className="inventory-explorer-header">
        <div>
          <Space size={10} align="center">
            <RadarChartOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
            <Title level={3} style={{ margin: 0 }}>
              Inventory Explorer
            </Title>
          </Space>
          <Text type="secondary" style={{ display: "block", marginTop: 6, maxWidth: 720 }}>
            Inspect effective host variables, trace precedence, and write only to valid host-level overrides.
          </Text>
        </div>
        <Button onClick={() => navigate("/inventory/overview")}>Back To Inventory Overview</Button>
      </div>

      <Card
        size="small"
        className="inventory-explorer-toolbar"
        styles={{ body: { display: "grid", gap: 12 } }}
      >
        <div className="inventory-explorer-toolbar-row">
          <div className="inventory-explorer-toolbar-select">
            <Text type="secondary">Target Host</Text>
            <Select
              showSearch
              value={Number.isFinite(selectedHostId) && selectedHostId > 0 ? selectedHostId : undefined}
              options={hostOptions}
              style={{ width: "100%" }}
              placeholder="Choose a host"
              filterOption={filterSelectOption}
              onChange={(value) => {
                setSearchParams({ host: String(value) });
              }}
            />
          </div>
          <Space wrap>
            <Button
              icon={<InfoCircleOutlined />}
              onClick={() => setDetailsOpen(true)}
              disabled={!hostDetails && !explorerQuery.isLoading}
            >
              Host Details
            </Button>
            <Button
              icon={<PartitionOutlined />}
              onClick={() => navigate(`/inventory/hierarchy${selectedHostId ? `?host=${selectedHostId}` : ""}`)}
            >
              Inventory Hierarchy
            </Button>
            <Button
              icon={<ApiOutlined />}
              onClick={() => window.open("/api/inventory/ansible", "_blank", "noopener,noreferrer")}
            >
              Export Inventory
            </Button>
          </Space>
        </div>

        <div className="inventory-explorer-summary-grid">
          <div className="inventory-explorer-summary-card">
            <Text type="secondary">Visible Vars</Text>
            <Title level={4} style={{ margin: 0 }}>
              {stats.total}
            </Title>
          </div>
          <div className="inventory-explorer-summary-card">
            <Text type="secondary">Editable</Text>
            <Title level={4} style={{ margin: 0 }}>
              {stats.editable}
            </Title>
          </div>
          <div className="inventory-explorer-summary-card">
            <Text type="secondary">Host Overrides</Text>
            <Title level={4} style={{ margin: 0 }}>
              {stats.overridden}
            </Title>
          </div>
        </div>
      </Card>

      {explorerQuery.isLoading && !hostDetails ? (
        <div className="inventory-explorer-loading">
          <Spin />
        </div>
      ) : (
        <InventoryHostVarsPanel hostId={selectedHostId || null} data={hostDetails} />
      )}

      <Drawer
        title="Host Details"
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        width={isMobile ? "100%" : 420}
      >
        {explorerQuery.isLoading ? (
          <div className="inventory-explorer-loading">
            <Spin />
          </div>
        ) : hostDetails ? (
          <div className="inventory-explorer-details-stack">
            <Card size="small">
              <Space direction="vertical" size={2}>
                <Text type="secondary">Active Host</Text>
                <Title level={4} style={{ margin: 0 }}>
                  {hostDetails.host.name}
                </Title>
                <Text type="secondary">
                  #{hostDetails.host.id}
                  {hostDetails.host.ipv4 ? ` · ${hostDetails.host.ipv4}` : ""}
                </Text>
              </Space>
              <div className="inventory-explorer-host-badges">
                {hostDetails.host.environment && (
                  <span
                    className="inventory-explorer-token-pill"
                    style={inventoryExplorerGroupStyle("environment", token)}
                  >
                    {hostDetails.host.environment}
                  </span>
                )}
                {hostDetails.host.host_type && (
                  <span
                    className="inventory-explorer-token-pill"
                    style={inventoryExplorerGroupStyle("type", token)}
                  >
                    {hostDetails.host.host_type}
                  </span>
                )}
                {hostDetails.host.status && (
                  <span
                    className="inventory-explorer-token-pill"
                    style={inventoryExplorerGroupStyle("status", token)}
                  >
                    {hostDetails.host.status}
                  </span>
                )}
              </div>
            </Card>

            <Card size="small" title={<Space><NodeIndexOutlined /><span>Groups</span></Space>}>
              <div className="inventory-explorer-group-grid">
                {hostDetails.groups.map((group: InventoryExplorerGroup) => (
                  <div key={group.name} className="inventory-explorer-group-pill">
                    <span
                      className="inventory-explorer-token-pill"
                      style={inventoryExplorerGroupStyle(group.category, token)}
                    >
                      {group.category}
                    </span>
                    <Text strong>{group.label}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {group.name}
                    </Text>
                  </div>
                ))}
              </div>
            </Card>

            <Card size="small" title={<Space><ClusterOutlined /><span>Precedence Reference</span></Space>}>
              <div className="inventory-explorer-layer-legend">
                {layerOrder.map((layerKey) => {
                  const layerStyle = inventoryExplorerLayerStyle(layerKey, token);
                  return (
                    <div key={layerKey} className="inventory-explorer-layer-chip">
                      <span
                        className="inventory-explorer-layer-dot"
                        style={{ background: layerStyle.color, color: layerStyle.color }}
                      />
                      <span>{layerKey.replace(/_/g, " ")}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        ) : (
          <Empty description="Pick a host to load its rendered inventory." />
        )}
      </Drawer>
    </div>
  );
}
