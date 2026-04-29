import { useState } from "react";
import {
  Badge,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { CaretRightOutlined, EyeOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelPlaybookRun, createPlaybookRun, listGitRepos, listPlaybookRuns, listPlaybooks } from "../api/git";
import InventoryTargetSelector from "../components/InventoryTargetSelector";
import PlaybookRunOutput from "../components/PlaybookRunOutput";
import { useAuth } from "../store/AuthContext";
import type { AnsiblePlaybook, GitRepo, InventoryFilters, InventoryFilterType, PlaybookRun, PlaybookRunStatus } from "../types";
import { buildSortedOptions, filterSelectOption } from "../utils/selectOptions";

const { Text, Title } = Typography;

const STATUS_COLOR: Record<PlaybookRunStatus, string> = {
  pending: "default",
  running: "processing",
  success: "success",
  failed: "error",
  cancelled: "warning",
};

export default function PlaybookRunsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<number | null>(null);
  const [hostSource, setHostSource] = useState<"inventory" | "repo">("inventory");
  const [inventoryFilters, setInventoryFilters] = useState<InventoryFilters>({});
  const [extraVarsRaw, setExtraVarsRaw] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [drawerRun, setDrawerRun] = useState<PlaybookRun | null>(null);

  function syncDrawerRunStatus(status: PlaybookRunStatus, exitCode: number | null) {
    setDrawerRun((current) =>
      current
        ? {
            ...current,
            status,
            exit_code: exitCode,
            finished_at: status === "running" ? current.finished_at : current.finished_at ?? new Date().toISOString(),
          }
        : current
    );
  }

  const { data: runsData, isLoading } = useQuery({
    queryKey: ["/playbook-runs"],
    queryFn: () => listPlaybookRuns({ limit: 100 }),
    refetchInterval: 5000,
  });
  const { data: reposData } = useQuery({
    queryKey: ["/git-repos"],
    queryFn: () => listGitRepos(0, 200),
  });
  const { data: playbooksData } = useQuery({
    queryKey: ["/ansible-playbooks", selectedRepoId],
    queryFn: () => (selectedRepoId ? listPlaybooks(selectedRepoId, 0, 200) : Promise.resolve({ items: [], total: 0 })),
    enabled: !!selectedRepoId,
  });

  const createMutation = useMutation({
    mutationFn: createPlaybookRun,
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ["/playbook-runs"] });
      message.success("Playbook run started.");
      setCreateOpen(false);
      setDrawerRun(run);
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFormError(detail ?? "Failed to start run.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelPlaybookRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/playbook-runs"] });
      message.success("Run cancelled.");
    },
  });

  function toLegacyInventoryFilter(filters: InventoryFilters): { type: InventoryFilterType; value: unknown } {
    if (filters.environment_ids?.length) return { type: "environment", value: filters.environment_ids };
    if (filters.role_ids?.length) return { type: "role", value: filters.role_ids };
    if (filters.status_ids?.length) return { type: "status", value: filters.status_ids };
    if (filters.vlan_ids?.length) return { type: "vlan", value: filters.vlan_ids };
    if (filters.host_ids?.length) return { type: "hosts", value: filters.host_ids };
    if (filters.pattern?.trim()) return { type: "pattern", value: filters.pattern.trim() };
    return { type: "all", value: null };
  }

  function handleCreate() {
    setFormError(null);
    if (!selectedPlaybookId) {
      setFormError("Select a playbook.");
      return;
    }

    let extra_vars: Record<string, unknown> | undefined;
    if (extraVarsRaw.trim()) {
      try {
        extra_vars = JSON.parse(extraVarsRaw);
      } catch {
        setFormError("Extra vars must be valid JSON.");
        return;
      }
    }

    const legacyFilter = toLegacyInventoryFilter(inventoryFilters);
    createMutation.mutate({
      playbook_id: selectedPlaybookId,
      host_source: hostSource,
      inventory_filter_type: hostSource === "inventory" ? legacyFilter.type : undefined,
      inventory_filter_value: hostSource === "inventory" ? legacyFilter.value : undefined,
      extra_vars,
    });
  }

  const ansibleRepos = reposData?.items?.filter((repo: GitRepo) => repo.repo_type === "ansible") ?? [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Automation Runs</Title>
        {isAdmin && (
          <Button
            type="primary"
            icon={<CaretRightOutlined />}
            onClick={() => {
              setCreateOpen(true);
              setSelectedRepoId(null);
              setSelectedPlaybookId(null);
              setHostSource("inventory");
              setInventoryFilters({});
              setExtraVarsRaw("");
              setFormError(null);
            }}
          >
            Run Playbook
          </Button>
        )}
      </div>

      <Table<PlaybookRun>
        rowKey="id"
        loading={isLoading}
        dataSource={runsData?.items ?? []}
        pagination={{ pageSize: 50 }}
        onRow={(record) => ({ onDoubleClick: () => setDrawerRun(record) })}
        columns={[
          { title: "ID", dataIndex: "id", width: 60 },
          { title: "Playbook", dataIndex: "playbook_id", render: (value: number) => value },
          { title: "Status", dataIndex: "status", render: (value: PlaybookRunStatus) => <Badge status={STATUS_COLOR[value] as never} text={value} /> },
          { title: "Host Source", dataIndex: "host_source" },
          { title: "Target", render: (_: unknown, record: PlaybookRun) => record.inventory_filter_type ?? "repo" },
          { title: "Created", dataIndex: "created_at", render: (value: string) => new Date(value).toLocaleString() },
          {
            title: "Actions",
            render: (_: unknown, record: PlaybookRun) => (
              <Space>
                <Button size="small" icon={<EyeOutlined />} onClick={() => setDrawerRun(record)} />
                {(record.status === "running" || record.status === "pending") && isAdmin && (
                  <Popconfirm title="Cancel this run?" onConfirm={() => cancelMutation.mutate(record.id)}>
                    <Button size="small" danger icon={<StopOutlined />} />
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={drawerRun ? `Run #${drawerRun.id}` : "Run Output"}
        open={!!drawerRun}
        onClose={() => setDrawerRun(null)}
        width={720}
      >
        {drawerRun && (
          <>
            <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Playbook ID">{drawerRun.playbook_id}</Descriptions.Item>
              <Descriptions.Item label="Host Source">{drawerRun.host_source}</Descriptions.Item>
              <Descriptions.Item label="Created">{new Date(drawerRun.created_at).toLocaleString()}</Descriptions.Item>
              {drawerRun.finished_at && (
                <Descriptions.Item label="Finished">{new Date(drawerRun.finished_at).toLocaleString()}</Descriptions.Item>
              )}
            </Descriptions>
            <PlaybookRunOutput
              runId={drawerRun.id}
              initialOutput={drawerRun.output}
              initialStatus={drawerRun.status}
              onStatusChange={syncDrawerRunStatus}
            />
          </>
        )}
      </Drawer>

      <Modal
        title="Run Ansible Playbook"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText="Run"
        confirmLoading={createMutation.isPending}
        width={560}
      >
        <Form layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="Repository" required>
            <Select
              placeholder="Select an Ansible repo"
              showSearch
              filterOption={filterSelectOption}
              onChange={(value) => {
                setSelectedRepoId(value);
                setSelectedPlaybookId(null);
              }}
              value={selectedRepoId ?? undefined}
              options={buildSortedOptions(ansibleRepos, (repo: GitRepo) => ({ value: repo.id, label: repo.name }))}
            />
          </Form.Item>

          <Form.Item label="Playbook" required>
            <Select
              placeholder="Select a playbook"
              disabled={!selectedRepoId}
              showSearch
              filterOption={filterSelectOption}
              onChange={(value) => setSelectedPlaybookId(value)}
              value={selectedPlaybookId ?? undefined}
              options={buildSortedOptions(playbooksData?.items ?? [], (playbook: AnsiblePlaybook) => ({
                value: playbook.id,
                label: playbook.path,
              }))}
            />
          </Form.Item>

          <Form.Item label="Host Source">
            <Select
              value={hostSource}
              onChange={(value) => setHostSource(value)}
              options={[
                { value: "inventory", label: "Slimventory inventory" },
                { value: "repo", label: "Repo inventory" },
              ]}
            />
          </Form.Item>

          {hostSource === "inventory" && (
            <InventoryTargetSelector
              filters={inventoryFilters}
              onChange={setInventoryFilters}
            />
          )}

          <Form.Item label="Extra Variables (JSON)">
            <Input.TextArea
              rows={4}
              value={extraVarsRaw}
              onChange={(e) => setExtraVarsRaw(e.target.value)}
              style={{ fontFamily: "monospace" }}
            />
          </Form.Item>

          {formError && <Text type="danger">{formError}</Text>}
        </Form>
      </Modal>
    </div>
  );
}
