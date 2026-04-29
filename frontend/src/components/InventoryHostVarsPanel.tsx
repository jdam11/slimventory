import {
  LockOutlined,
  RadarChartOutlined,
  RetweetOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Alert, Button, Empty, Input, Space, Spin, Table, Tag, Typography, message, theme as antdTheme } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import api from "../api/client";
import { useAuth } from "../store/AuthContext";
import type { InventoryExplorerData, InventoryExplorerLineageEntry, InventoryExplorerVar } from "../types";
import { inventoryExplorerLayerStyle } from "../utils/inventoryExplorerTheme";

const { Title, Text } = Typography;

function valueLabel(item: InventoryExplorerVar): string {
  if (item.value == null || item.value === "") {
    return "not set";
  }
  return item.value;
}

function lineageValue(entry: InventoryExplorerLineageEntry): string {
  if (entry.value == null || entry.value === "") {
    return "not set";
  }
  return entry.value;
}

interface InventoryHostVarsPanelProps {
  hostId: number | null;
  data?: InventoryExplorerData | null;
  className?: string;
  compact?: boolean;
}

export default function InventoryHostVarsPanel({ hostId, data, className, compact = false }: InventoryHostVarsPanelProps) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { token } = antdTheme.useToken();

  const [search, setSearch] = useState("");
  const [selectedVarKey, setSelectedVarKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");

  const explorerQuery = useQuery({
    queryKey: ["/inventory/explorer", hostId],
    queryFn: () =>
      api.get<InventoryExplorerData>(`/inventory/hosts/${hostId}/explorer`).then((response) => response.data),
    enabled: !data && Number.isFinite(hostId) && (hostId ?? 0) > 0,
  });

  const explorerData = data ?? explorerQuery.data ?? null;

  const visibleVars = useMemo(() => {
    const items = explorerData?.vars ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => {
      const haystack = `${item.key} ${item.source_label ?? ""} ${item.source_layer ?? ""} ${item.value ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [explorerData?.vars, search]);

  const selectedVar = useMemo(() => {
    if (!visibleVars.length) return search.trim() ? null : explorerData?.vars?.[0] ?? null;
    return visibleVars.find((item) => item.key === selectedVarKey) ?? visibleVars[0] ?? null;
  }, [explorerData?.vars, search, selectedVarKey, visibleVars]);

  useEffect(() => {
    if (selectedVar && selectedVar.key !== selectedVarKey) {
      setSelectedVarKey(selectedVar.key);
    }
  }, [selectedVar, selectedVarKey]);

  useEffect(() => {
    if (!selectedVar) {
      setDraftValue("");
      return;
    }
    setDraftValue(selectedVar.is_secret ? "" : selectedVar.value ?? "");
  }, [selectedVar]);

  const saveMutation = useMutation({
    mutationFn: async ({ item, remove, value }: { item: InventoryExplorerVar; remove: boolean; value: string }) => {
      if (!hostId || !item.override_target) {
        throw new Error("No editable variable selected");
      }
      return api
        .put<InventoryExplorerData>(`/inventory/hosts/${hostId}/explorer/overrides`, {
          updates: [
            {
              key: item.key,
              kind: item.override_target.kind,
              target_id: item.override_target.target_id,
              target_name: item.override_target.target_name,
              app_id: item.override_target.app_id,
              value: remove ? null : value,
              remove,
            },
          ],
        })
        .then((response) => response.data);
    },
    onSuccess: (nextData, variables) => {
      qc.setQueryData(["/inventory/explorer", hostId], nextData);
      qc.invalidateQueries({ queryKey: ["/inventory"] });
      qc.invalidateQueries({ queryKey: ["/inventory/explorer", hostId] });
      message.success(variables.remove ? "Host override removed" : "Host override saved");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          ?? (error as Error).message
          ?? "Failed to save inventory override"
      );
    },
  });

  if (!hostId) {
    return (
      <div className={`inventory-explorer-panel-grid${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}>
        <div
          className="inventory-explorer-card inventory-explorer-detail"
          style={{
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Empty description="Select a host to inspect effective variables and lineage." />
        </div>
      </div>
    );
  }

  return (
    <div className={`inventory-explorer-panel-grid${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}>
      <div
        className="inventory-explorer-card"
        style={{
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div className="inventory-explorer-panel-head">
          <div>
            <Text type="secondary">Rendered Variables</Text>
            <Title level={4} style={{ margin: "4px 0 0" }}>
              Hostvar Browser
            </Title>
          </div>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by key, source, or value"
            style={{ maxWidth: 320 }}
          />
        </div>

        {explorerQuery.isLoading && !explorerData ? (
          <div className="inventory-explorer-loading">
            <Spin />
          </div>
        ) : visibleVars.length === 0 ? (
          <Empty description="No variables match the current search." />
        ) : compact ? (
          <Table<InventoryExplorerVar>
            rowKey="key"
            size="small"
            className="inventory-explorer-hostvar-table"
            pagination={{ pageSize: 10, size: "small" }}
            dataSource={visibleVars}
            expandable={{
              expandedRowKeys: selectedVar ? [selectedVar.key] : [],
              expandRowByClick: true,
              onExpand: (expanded, record) => {
                setSelectedVarKey(expanded ? record.key : null);
              },
              expandedRowRender: (item) => {
                const isSelected = selectedVar?.key === item.key;
                const editorValue = isSelected ? draftValue : (item.is_secret ? "" : item.value ?? "");
                return (
                  <div className="inventory-explorer-table-detail">
                    <div className="inventory-explorer-signal-strip">
                      <div className="inventory-explorer-signal-block">
                        <Text type="secondary">Effective Value</Text>
                        <div className="inventory-explorer-signal-value">{valueLabel(item)}</div>
                      </div>
                      <div className="inventory-explorer-signal-block">
                        <Text type="secondary">Winning Source</Text>
                        <div className="inventory-explorer-signal-value">{item.source_label ?? "Unknown"}</div>
                      </div>
                      <div className="inventory-explorer-signal-block">
                        <Text type="secondary">Write Path</Text>
                        <div className="inventory-explorer-signal-value">
                          {item.editable && item.override_target ? item.override_target.label : item.edit_reason ?? "No override path"}
                        </div>
                      </div>
                    </div>

                    {isAdmin && item.editable && item.override_target ? (
                      <div
                        className="inventory-explorer-editor"
                        style={{
                          background: token.colorFillSecondary,
                          border: `1px solid ${token.colorBorderSecondary}`,
                        }}
                      >
                        <div className="inventory-explorer-panel-title">
                          <RetweetOutlined />
                          <span>Host Override Editor</span>
                        </div>
                        {item.is_secret ? (
                          <Input.Password
                            value={editorValue}
                            onChange={(event) => {
                              setSelectedVarKey(item.key);
                              setDraftValue(event.target.value);
                            }}
                            placeholder="Enter a replacement secret value"
                          />
                        ) : (
                          <Input.TextArea
                            value={editorValue}
                            onChange={(event) => {
                              setSelectedVarKey(item.key);
                              setDraftValue(event.target.value);
                            }}
                            autoSize={{ minRows: 2, maxRows: 5 }}
                            placeholder="Override value"
                          />
                        )}
                        <Space wrap>
                          <Button
                            type="primary"
                            size="small"
                            icon={<SaveOutlined />}
                            loading={saveMutation.isPending}
                            disabled={item.is_secret ? !editorValue : false}
                            onClick={() => {
                              setSelectedVarKey(item.key);
                              if (!isSelected) {
                                setDraftValue(item.is_secret ? "" : item.value ?? "");
                              }
                              void saveMutation.mutateAsync({ item, remove: false, value: editorValue });
                            }}
                          >
                            Save Override
                          </Button>
                          <Button
                            size="small"
                            disabled={!item.has_host_override || saveMutation.isPending}
                            onClick={() => {
                              setSelectedVarKey(item.key);
                              void saveMutation.mutateAsync({ item, remove: true, value: editorValue });
                            }}
                          >
                            Reset
                          </Button>
                        </Space>
                      </div>
                    ) : (
                      <Alert
                        type={item.editable ? "info" : "warning"}
                        showIcon
                        message={
                          item.editable
                            ? "Editing is restricted to admin users."
                            : item.edit_reason ?? "This variable cannot be edited from the explorer."
                        }
                      />
                    )}

                    <div className="inventory-explorer-lineage">
                      <div className="inventory-explorer-panel-title">
                        <RadarChartOutlined />
                        <span>Lineage Trace</span>
                      </div>
                      <div className="inventory-explorer-lineage-list is-compact">
                        {item.lineage.map((entry) => (
                          <div
                            key={`${item.key}-${entry.precedence}-${entry.source_kind}-${entry.source_label}`}
                            className={`inventory-explorer-lineage-row${entry.applied ? " is-applied" : ""}`}
                            style={{
                              borderColor: entry.applied
                                ? inventoryExplorerLayerStyle(entry.layer_key, token).borderColor
                                : token.colorBorderSecondary,
                              background: entry.applied
                                ? inventoryExplorerLayerStyle(entry.layer_key, token).background
                                : token.colorBgElevated,
                            }}
                          >
                            <div className="inventory-explorer-lineage-rail">
                              <span
                                className="inventory-explorer-lineage-dot"
                                style={{
                                  background: inventoryExplorerLayerStyle(entry.layer_key, token).color,
                                  color: inventoryExplorerLayerStyle(entry.layer_key, token).color,
                                }}
                              />
                            </div>
                            <div className="inventory-explorer-lineage-body">
                              <div className="inventory-explorer-lineage-header">
                                <div>
                                  <Text strong>{entry.layer_label}</Text>
                                  <Text type="secondary" style={{ display: "block" }}>
                                    {entry.source_label}
                                  </Text>
                                </div>
                                <Space wrap size={6}>
                                  <Tag>{entry.precedence}</Tag>
                                  {entry.applied && <Tag color="success">effective here</Tag>}
                                  {entry.editable && <Tag color="processing">host-writable</Tag>}
                                </Space>
                              </div>
                              <div className="inventory-explorer-lineage-value">{lineageValue(entry)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              },
            }}
            columns={[
              {
                title: "Key",
                dataIndex: "key",
                key: "key",
                width: 220,
                render: (value: string, item) => (
                  <Space size={8} wrap>
                    <Text code>{value}</Text>
                    {item.is_secret && <Tag icon={<LockOutlined />}>secret</Tag>}
                    {item.has_host_override && <Tag color="green">override</Tag>}
                  </Space>
                ),
              },
              {
                title: "Value",
                dataIndex: "value",
                key: "value",
                render: (_: string | null, item) => <span className="inventory-explorer-table-value">{valueLabel(item)}</span>,
              },
              {
                title: "Source",
                key: "source",
                render: (_: unknown, item) => (
                  <div className="inventory-explorer-table-source">
                    <div>{item.source_layer ?? "Unknown layer"}</div>
                    <Text type="secondary">{item.source_label ?? "No source label"}</Text>
                  </div>
                ),
              },
              {
                title: "Edit",
                key: "edit",
                width: 120,
                render: (_: unknown, item) => (
                  item.editable ? <Tag color="blue">editable</Tag> : <Tag>read only</Tag>
                ),
              },
            ]}
          />
        ) : (
          <div className="inventory-explorer-var-list">
            {visibleVars.map((item) => {
              const isActive = item.key === selectedVar?.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`inventory-explorer-var-row${isActive ? " is-active" : ""}`}
                  style={{
                    background: isActive ? token.colorPrimaryBg : token.colorBgElevated,
                    borderColor: isActive ? token.colorPrimaryBorder : token.colorBorderSecondary,
                  }}
                  onClick={() => setSelectedVarKey(item.key)}
                >
                  <div className="inventory-explorer-var-topline">
                    <Text code>{item.key}</Text>
                    <Space size={6} wrap>
                      {item.is_secret && <Tag icon={<LockOutlined />}>secret</Tag>}
                      {item.has_host_override && <Tag color="green">host override</Tag>}
                      {item.editable ? <Tag color="blue">editable</Tag> : <Tag>read only</Tag>}
                    </Space>
                  </div>
                  <div className="inventory-explorer-var-value">{valueLabel(item)}</div>
                  <div className="inventory-explorer-var-meta">
                    <span>{item.source_layer ?? "Unknown layer"}</span>
                    <span>{item.source_label ?? "No source label"}</span>
                  </div>
                  {isActive ? (
                    item.editable && selectedVar?.override_target ? (
                      <div
                        className="inventory-explorer-inline-editor"
                        style={{
                          background: token.colorBgContainer,
                          border: `1px solid ${token.colorBorderSecondary}`,
                        }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          Override path: {selectedVar.override_target.label}
                        </Text>
                        {selectedVar.is_secret ? (
                          <Input.Password
                            value={draftValue}
                            onChange={(event) => setDraftValue(event.target.value)}
                            placeholder="Enter a replacement secret value"
                          />
                        ) : (
                          <Input.TextArea
                            value={draftValue}
                            onChange={(event) => setDraftValue(event.target.value)}
                            autoSize={{ minRows: 2, maxRows: 6 }}
                            placeholder="Override value"
                          />
                        )}
                        <Space wrap>
                          <Button
                            type="primary"
                            size="small"
                            icon={<SaveOutlined />}
                            loading={saveMutation.isPending}
                            disabled={selectedVar.is_secret ? !draftValue : false}
                            onClick={() => void saveMutation.mutateAsync({ item: selectedVar, remove: false, value: draftValue })}
                          >
                            Save Override
                          </Button>
                          <Button
                            size="small"
                            disabled={!selectedVar.has_host_override || saveMutation.isPending}
                            onClick={() => void saveMutation.mutateAsync({ item: selectedVar, remove: true, value: draftValue })}
                          >
                            Reset
                          </Button>
                        </Space>
                      </div>
                    ) : (
                      <div
                        className="inventory-explorer-inline-editor"
                        style={{
                          background: token.colorBgContainer,
                          border: `1px solid ${token.colorBorderSecondary}`,
                        }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.editable
                            ? "Editing is restricted to admin users."
                            : item.edit_reason ?? "This variable cannot be overridden from the host view."}
                        </Text>
                      </div>
                    )
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!compact ? (
      <div
        className="inventory-explorer-card inventory-explorer-detail"
        style={{
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {!selectedVar ? (
          <Empty description="Select a variable to inspect its lineage." />
        ) : (
          <>
            <div className="inventory-explorer-panel-head">
              <div>
                <Text type="secondary">Selected Variable</Text>
                <Title level={3} style={{ margin: "4px 0 0" }}>
                  {selectedVar.key}
                </Title>
              </div>
              <Space wrap>
                {selectedVar.source_layer && <Tag color="processing">{selectedVar.source_layer}</Tag>}
                {selectedVar.has_host_override && <Tag color="green">Host override active</Tag>}
              </Space>
            </div>

            <div className="inventory-explorer-signal-strip">
              <div className="inventory-explorer-signal-block">
                <Text type="secondary">Effective Value</Text>
                <div className="inventory-explorer-signal-value">{valueLabel(selectedVar)}</div>
              </div>
              <div className="inventory-explorer-signal-block">
                <Text type="secondary">Winning Source</Text>
                <div className="inventory-explorer-signal-value">{selectedVar.source_label ?? "Unknown"}</div>
              </div>
              <div className="inventory-explorer-signal-block">
                <Text type="secondary">Write Path</Text>
                <div className="inventory-explorer-signal-value">
                  {selectedVar.editable && selectedVar.override_target ? selectedVar.override_target.label : selectedVar.edit_reason ?? "No override path"}
                </div>
              </div>
            </div>

            {isAdmin && selectedVar.editable && selectedVar.override_target ? (
              <div
                className="inventory-explorer-editor"
                style={{
                  background: token.colorFillQuaternary,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <div className="inventory-explorer-panel-title">
                  <RetweetOutlined />
                  <span>Host Override Editor</span>
                </div>
                <Text type="secondary">
                  Changes here write only to the host-level override target for this variable.
                </Text>
                {selectedVar.is_secret ? (
                  <Input.Password
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                    placeholder="Enter a replacement secret value"
                  />
                ) : (
                  <Input.TextArea
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    placeholder="Override value"
                  />
                )}
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={saveMutation.isPending}
                    disabled={selectedVar.is_secret ? !draftValue : false}
                    onClick={() => void saveMutation.mutateAsync({ item: selectedVar, remove: false, value: draftValue })}
                  >
                    Save Host Override
                  </Button>
                  <Button
                    disabled={!selectedVar.has_host_override || saveMutation.isPending}
                    onClick={() => void saveMutation.mutateAsync({ item: selectedVar, remove: true, value: draftValue })}
                  >
                    Reset To Inherited
                  </Button>
                </Space>
              </div>
            ) : (
              <Alert
                type={selectedVar.editable ? "info" : "warning"}
                showIcon
                message={
                  selectedVar.editable
                    ? "You can view the lineage here, but editing is restricted to admin users."
                    : selectedVar.edit_reason ?? "This variable cannot be edited from the explorer."
                }
              />
            )}

            <div className="inventory-explorer-lineage">
              <div className="inventory-explorer-panel-title">
                <RadarChartOutlined />
                <span>Lineage Trace</span>
              </div>
              <Text type="secondary">
                Low-precedence layers appear first. A highlighted segment marks each point where the effective value changed.
              </Text>
              <div className="inventory-explorer-lineage-list">
                {selectedVar.lineage.map((entry) => (
                  <div
                    key={`${entry.precedence}-${entry.source_kind}-${entry.source_label}`}
                    className={`inventory-explorer-lineage-row${entry.applied ? " is-applied" : ""}`}
                    style={{
                      borderColor: entry.applied
                        ? inventoryExplorerLayerStyle(entry.layer_key, token).borderColor
                        : token.colorBorderSecondary,
                      background: entry.applied
                        ? inventoryExplorerLayerStyle(entry.layer_key, token).background
                        : token.colorFillQuaternary,
                    }}
                  >
                    <div className="inventory-explorer-lineage-rail">
                      <span
                        className="inventory-explorer-lineage-dot"
                        style={{
                          background: inventoryExplorerLayerStyle(entry.layer_key, token).color,
                          color: inventoryExplorerLayerStyle(entry.layer_key, token).color,
                        }}
                      />
                    </div>
                    <div className="inventory-explorer-lineage-body">
                      <div className="inventory-explorer-lineage-header">
                        <div>
                          <Text strong>{entry.layer_label}</Text>
                          <Text type="secondary" style={{ display: "block" }}>
                            {entry.source_label}
                          </Text>
                        </div>
                        <Space wrap size={6}>
                          <Tag>{entry.precedence}</Tag>
                          {entry.applied && <Tag color="success">effective here</Tag>}
                          {entry.editable && <Tag color="processing">host-writable</Tag>}
                        </Space>
                      </div>
                      <div className="inventory-explorer-lineage-value">{lineageValue(entry)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      ) : null}
    </div>
  );
}
