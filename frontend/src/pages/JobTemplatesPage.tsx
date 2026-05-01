import { useEffect, useState } from "react";
import { Alert, Button, Collapse, Descriptions, Divider, Drawer, Empty, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { DeleteOutlined, EditOutlined, EyeOutlined, HistoryOutlined, PlusOutlined, PlayCircleOutlined, RadarChartOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listAiToolCandidates } from "../api/ai";
import { listPlaybooks, listGitRepos } from "../api/git";
import {
  createJobTemplate,
  deleteJobTemplate,
  deleteJobTemplateSchedule,
  getJobTemplatePreview,
  getJobTemplateRuns,
  getJobTemplateSchedule,
  launchJobTemplate,
  listJobTemplates,
  refreshJobTemplatePreview,
  listVaultCredentials,
  updateJobTemplate,
  upsertJobTemplateSchedule,
} from "../api/job_templates";
import InventoryTargetSelector from "../components/InventoryTargetSelector";
import PlaybookRunOutput from "../components/PlaybookRunOutput";
import { useAuth } from "../store/AuthContext";
import { useNavigate } from "react-router-dom";
import { buildSortedOptions, filterSelectOption } from "../utils/selectOptions";
import type {
  AnsiblePlaybook,
  GitRepo,
  InventoryFilters,
  JobTemplate,
  JobTemplatePreview,
  JobTemplatePreviewHost,
  JobTemplatePreviewTask,
  PlaybookRun,
  PlaybookRunStatus,
} from "../types";

const { Title } = Typography;

interface TemplateFormValues {
  name: string;
  description?: string;
  repo_id?: number;
  playbook_id?: number;
  extra_vars_raw?: string;
  vault_credential_id?: number;
  schedule_enabled?: boolean;
  cron_expr?: string;
  runbook_enabled?: boolean;
  runbook_category?: string;
  recommended_when?: string;
  risk_level?: string;
  alert_match_type?: string;
  alert_match_value?: string;
}

export default function JobTemplatesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<JobTemplate | null>(null);
  const [form] = Form.useForm<TemplateFormValues>();
  const repoId = Form.useWatch("repo_id", form);
  const [inventoryFilters, setInventoryFilters] = useState<InventoryFilters>({});
  const [outputRun, setOutputRun] = useState<PlaybookRun | null>(null);
  const [historyTemplate, setHistoryTemplate] = useState<JobTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<JobTemplate | null>(null);
  const [selectedPreviewHostId, setSelectedPreviewHostId] = useState<number | null>(null);

  function syncOutputRunStatus(status: PlaybookRunStatus, exitCode: number | null) {
    setOutputRun((current) =>
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

  const { data: templates, isLoading } = useQuery({
    queryKey: ["/job-templates"],
    queryFn: () => listJobTemplates(0, 200),
  });
  const { data: repos } = useQuery({
    queryKey: ["/git-repos"],
    queryFn: () => listGitRepos(0, 200),
  });
  const { data: playbooks } = useQuery({
    queryKey: ["/ansible-playbooks", repoId],
    queryFn: () => listPlaybooks(repoId, 0, 200),
    enabled: !!repoId,
  });
  const { data: vaultCredentials } = useQuery({
    queryKey: ["/vault-credentials"],
    queryFn: () => listVaultCredentials(0, 200),
  });
  const { data: historyRuns } = useQuery({
    queryKey: ["/job-templates", historyTemplate?.id, "runs"],
    queryFn: () => getJobTemplateRuns(historyTemplate!.id, 20),
    enabled: !!historyTemplate,
  });
  const { data: schedule } = useQuery({
    queryKey: ["/job-templates", editing?.id, "schedule"],
    queryFn: () => getJobTemplateSchedule(editing!.id),
    enabled: !!editing,
  });
  const { data: aiToolCandidates } = useQuery({
    queryKey: ["/ai/admin/tool-candidates"],
    queryFn: listAiToolCandidates,
    enabled: isAdmin,
  });

  const ansibleRepos = (repos?.items ?? []).filter((repo) => repo.repo_type === "ansible");
  const { data: previewData, isFetching: previewLoading } = useQuery({
    queryKey: ["/job-templates", previewTemplate?.id, "preview"],
    queryFn: () => getJobTemplatePreview(previewTemplate!.id),
    enabled: !!previewTemplate,
  });

  useEffect(() => {
    if (!previewData?.target_hosts?.length) {
      setSelectedPreviewHostId(null);
      return;
    }
    setSelectedPreviewHostId((current) =>
      current && previewData.target_hosts.some((host) => host.host_id === current)
        ? current
        : previewData.target_hosts[0].host_id
    );
  }, [previewData]);

  useEffect(() => {
    if (editing) {
      form.setFieldsValue({
        schedule_enabled: schedule?.is_enabled ?? false,
        cron_expr: schedule?.cron_expr ?? "",
      });
    }
  }, [editing, schedule, form]);

  const createMutation = useMutation({
    mutationFn: createJobTemplate,
    onSuccess: async (template) => {
      await saveSchedule(template.id);
      qc.invalidateQueries({ queryKey: ["/job-templates"] });
      message.success("Job template created.");
      setOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<JobTemplate> }) => updateJobTemplate(id, payload),
    onSuccess: async (_, variables) => {
      await saveSchedule(variables.id);
      qc.invalidateQueries({ queryKey: ["/job-templates"] });
      message.success("Job template updated.");
      setOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteJobTemplate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/job-templates"] });
      message.success("Job template deleted.");
    },
  });

  const launchMutation = useMutation({
    mutationFn: launchJobTemplate,
    onSuccess: (run) => {
      message.success("Job template run started.");
      setOutputRun(run);
    },
  });
  const refreshPreviewMutation = useMutation({
    mutationFn: refreshJobTemplatePreview,
    onSuccess: (preview) => {
      qc.setQueryData(["/job-templates", preview.job_template_id, "preview"], preview);
      message.success("Template preview refreshed.");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to refresh preview."
      );
    },
  });
  async function saveSchedule(templateId: number) {
    const values = form.getFieldsValue();
    if (values.schedule_enabled && values.cron_expr) {
      await upsertJobTemplateSchedule(templateId, {
        cron_expr: values.cron_expr,
        is_enabled: true,
      });
    } else if (editing) {
      await deleteJobTemplateSchedule(templateId).catch(() => undefined);
    }
  }

  function openCreate() {
    setEditing(null);
    setInventoryFilters({});
    form.resetFields();
    form.setFieldsValue({ schedule_enabled: false });
    setOpen(true);
  }

  function openEdit(template: JobTemplate) {
    setEditing(template);
    setInventoryFilters(legacyFilterToObject(template));
    form.setFieldsValue({
      name: template.name,
      description: template.description ?? undefined,
      repo_id: undefined,
      playbook_id: template.playbook_id ?? undefined,
      extra_vars_raw: template.extra_vars ? JSON.stringify(template.extra_vars, null, 2) : "",
      vault_credential_id: template.vault_credential_id ?? undefined,
      runbook_enabled: template.runbook_enabled,
      runbook_category: template.runbook_category ?? undefined,
      recommended_when: template.recommended_when ?? undefined,
      risk_level: template.risk_level ?? undefined,
      alert_match_type: template.alert_match_type ?? undefined,
      alert_match_value: template.alert_match_value ?? undefined,
      schedule_enabled: false,
      cron_expr: "",
    });
    setOpen(true);
  }

  function handleSubmit(values: TemplateFormValues) {
    let extra_vars: Record<string, unknown> | null = null;
    if (values.extra_vars_raw?.trim()) {
      try {
        extra_vars = JSON.parse(values.extra_vars_raw);
      } catch {
        message.error("Extra vars must be valid JSON.");
        return;
      }
    }

    const payload = {
      name: values.name,
      description: values.description ?? null,
      playbook_id: values.playbook_id ?? null,
      inventory_filter_type: "all" as const,
      inventory_filter_value: null,
      inventory_filters: normalizeInventoryFilters(inventoryFilters),
      extra_vars,
      vault_credential_id: values.vault_credential_id ?? null,
      runbook_enabled: values.runbook_enabled ?? false,
      runbook_category: values.runbook_enabled ? values.runbook_category ?? null : null,
      recommended_when: values.runbook_enabled ? values.recommended_when ?? null : null,
      risk_level: values.runbook_enabled ? values.risk_level ?? null : null,
      alert_match_type: values.runbook_enabled ? values.alert_match_type ?? null : null,
      alert_match_value: values.runbook_enabled ? values.alert_match_value ?? null : null,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Job Templates</Title>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            New Template
          </Button>
        )}
      </div>

      <Table<JobTemplate>
        rowKey="id"
        loading={isLoading}
        dataSource={templates?.items ?? []}
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
          { title: "Playbook", dataIndex: "playbook_id", render: (value: number | null) => value ?? "—" },
          { title: "Inventory Target", render: (_: unknown, item: JobTemplate) => inventoryFilterSummary(item) },
          {
            title: "Runbook",
            render: (_: unknown, item: JobTemplate) =>
              item.runbook_enabled ? <Tag color="purple">{item.runbook_category || "Runbook"}</Tag> : "—",
          },
          {
            title: "AI",
            render: (_: unknown, item: JobTemplate) => {
              const candidate = (aiToolCandidates ?? []).find((entry) => entry.job_template_id === item.id);
              if (!candidate?.ai_tool_id) {
                return <Tag>Not exposed</Tag>;
              }
              return candidate.ai_enabled ? <Tag color="blue">AI tool enabled</Tag> : <Tag color="orange">AI tool disabled</Tag>;
            },
          },
          { title: "Updated", dataIndex: "updated_at", render: (value: string) => new Date(value).toLocaleString() },
          {
            title: "Actions",
            render: (_: unknown, item: JobTemplate) => (
              <Space>
                <Button size="small" icon={<PlayCircleOutlined />} disabled={!isAdmin} onClick={() => launchMutation.mutate(item.id)} />
                <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewTemplate(item)} />
                <Button size="small" onClick={() => navigate("/admin/ai-settings")}>AI Settings</Button>
                <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryTemplate(item)} />
                <Button size="small" icon={<EditOutlined />} disabled={!isAdmin} onClick={() => openEdit(item)} />
                <Popconfirm title="Delete this template?" onConfirm={() => deleteMutation.mutate(item.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} disabled={!isAdmin} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? "Edit Job Template" : "Create Job Template"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        width={720}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: "Name is required" }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="Repository" name="repo_id">
            <Select
              allowClear
              showSearch
              filterOption={filterSelectOption}
              options={buildSortedOptions(ansibleRepos, (repo: GitRepo) => ({ value: repo.id, label: repo.name }))}
            />
          </Form.Item>
          <Form.Item label="Playbook" name="playbook_id">
            <Select
              allowClear
              disabled={!repoId}
              showSearch
              filterOption={filterSelectOption}
              options={buildSortedOptions(playbooks?.items ?? [], (playbook: AnsiblePlaybook) => ({ value: playbook.id, label: playbook.path }))}
            />
          </Form.Item>
            <InventoryTargetSelector
              filters={inventoryFilters}
              onChange={setInventoryFilters}
            />
          <Form.Item label="Extra Vars JSON" name="extra_vars_raw">
            <Input.TextArea rows={4} style={{ fontFamily: "monospace" }} />
          </Form.Item>
          <Form.Item label="Vault Credential" name="vault_credential_id">
            <Select
              allowClear
              showSearch
              filterOption={filterSelectOption}
              options={buildSortedOptions(vaultCredentials?.items ?? [], (item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Divider orientation="left" plain>
            Runbook Metadata
          </Divider>
          <Form.Item label="Enable as Runbook" name="runbook_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.runbook_enabled !== next.runbook_enabled}>
            {({ getFieldValue }) =>
              getFieldValue("runbook_enabled") ? (
                <>
                  <Form.Item label="Category" name="runbook_category">
                    <Input placeholder="restart, cleanup, recovery" />
                  </Form.Item>
                  <Form.Item label="Recommended When" name="recommended_when">
                    <Input.TextArea rows={2} placeholder="Use when node exporter is down or host CPU is pinned." />
                  </Form.Item>
                  <Form.Item label="Risk Level" name="risk_level">
                    <Select
                      allowClear
                      options={[
                        { value: "low", label: "Low" },
                        { value: "medium", label: "Medium" },
                        { value: "high", label: "High" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="Alert Match Type" name="alert_match_type">
                    <Select
                      allowClear
                      options={[
                        { value: "host_down", label: "Host Down" },
                        { value: "high_cpu", label: "High CPU" },
                        { value: "high_memory", label: "High Memory" },
                        { value: "high_disk", label: "High Disk" },
                        { value: "job_unhealthy", label: "Job Unhealthy" },
                        { value: "service_errors", label: "Service Errors" },
                        { value: "service_volume", label: "Service Volume" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="Alert Match Value" name="alert_match_value">
                    <Input placeholder="Optional service or job name for narrower matching" />
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>
          <Form.Item label="Enable Schedule" name="schedule_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="Cron Expression" name="cron_expr">
            <Input placeholder="*/15 * * * *" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={previewTemplate ? `Execution Preview · ${previewTemplate.name}` : "Execution Preview"}
        open={!!previewTemplate}
        width={960}
        onClose={() => setPreviewTemplate(null)}
        extra={
          previewTemplate && isAdmin ? (
            <Button
              icon={<ReloadOutlined />}
              loading={refreshPreviewMutation.isPending}
              onClick={() => refreshPreviewMutation.mutate(previewTemplate.id)}
            >
              Refresh Cache
            </Button>
          ) : null
        }
      >
        {!previewTemplate ? null : previewLoading ? (
          <div>Loading preview…</div>
        ) : !previewData ? (
          <Alert type="warning" showIcon message="No preview available for this template." />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div
              style={{
                borderRadius: 18,
                padding: 18,
                border: "1px solid var(--ant-color-border-secondary)",
                background: "linear-gradient(135deg, var(--ant-color-primary-bg) 0%, var(--ant-color-bg-container) 100%)",
              }}
            >
              <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
                <div>
                  <Space align="center">
                    <RadarChartOutlined style={{ color: "var(--ant-color-primary)" }} />
                    <Title level={4} style={{ margin: 0 }}>Static Execution Preview</Title>
                  </Space>
                  <Typography.Text type="secondary">
                    Built from synced repo YAML and Slimventory targeting. Dynamic includes and conditions are labeled instead of executed.
                  </Typography.Text>
                </div>
                <Tag color={previewData.confidence === "direct" ? "green" : previewData.confidence === "dynamic" ? "orange" : "red"}>
                  {previewData.confidence}
                </Tag>
              </Space>
              <Descriptions size="small" column={2} style={{ marginTop: 16 }}>
                <Descriptions.Item label="Playbook">{previewData.playbook_path ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="Repo Commit">{previewData.repo_commit_sha ?? "unknown"}</Descriptions.Item>
                <Descriptions.Item label="Generated">{new Date(previewData.generated_at).toLocaleString()}</Descriptions.Item>
                <Descriptions.Item label="Target Hosts">{previewData.target_hosts.length}</Descriptions.Item>
              </Descriptions>
            </div>

            {previewData.dynamic_reasons.length > 0 && (
              <Alert
                type="info"
                showIcon
                message="Dynamic sections were detected"
                description={previewData.dynamic_reasons.join(" ")}
              />
            )}
            {previewData.unmatched_patterns.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`No hosts matched: ${previewData.unmatched_patterns.join(", ")}`}
              />
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(260px, 0.8fr) minmax(0, 1.2fr)",
                gap: 16,
                alignItems: "start",
              }}
            >
              <div
                style={{
                  borderRadius: 18,
                  padding: 16,
                  border: "1px solid var(--ant-color-border-secondary)",
                  background: "var(--ant-color-bg-container)",
                }}
              >
                <Title level={5} style={{ marginTop: 0 }}>Target Hosts</Title>
                <Space wrap>
                  {previewData.target_hosts.map((host) => (
                    <Tag key={host.host_id} color="blue">
                      {host.hostname}
                    </Tag>
                  ))}
                </Space>
                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                  {previewData.target_hosts.map((host) => (
                    <button
                      key={host.host_id}
                      type="button"
                      style={{
                        borderRadius: 14,
                        padding: 12,
                        background: selectedPreviewHostId === host.host_id ? "var(--ant-color-primary-bg)" : "var(--ant-color-fill-quaternary)",
                        border: selectedPreviewHostId === host.host_id
                          ? "1px solid var(--ant-color-primary-border)"
                          : "1px solid var(--ant-color-border-secondary)",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                      onClick={() => setSelectedPreviewHostId(host.host_id)}
                    >
                      <Typography.Text strong>{host.hostname}</Typography.Text>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>{host.ipv4 ?? "no IP"}</div>
                      {host.filter_reason ? (
                        <div style={{ fontSize: 12, marginTop: 8, opacity: 0.9 }}>{host.filter_reason}</div>
                      ) : null}
                      <div style={{ marginTop: 8 }}>
                        <Space wrap size={[4, 4]}>
                          {host.matched_by.map((token) => (
                            <Tag key={token}>{token}</Tag>
                          ))}
                          {host.matched_groups.map((group) => (
                            <Tag key={group} color="purple">{group}</Tag>
                          ))}
                        </Space>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div
                style={{
                  borderRadius: 18,
                  padding: 16,
                  border: "1px solid var(--ant-color-border-secondary)",
                  background: "var(--ant-color-bg-container)",
                }}
              >
                <Title level={5} style={{ marginTop: 0 }}>Host Lens</Title>
                <HostPreviewLens
                  preview={previewData}
                  selectedHost={previewData.target_hosts.find((host) => host.host_id === selectedPreviewHostId) ?? null}
                />
              </div>
            </div>
          </Space>
        )}
      </Drawer>

      <Drawer
        title={outputRun ? `Run #${outputRun.id}` : "Run Output"}
        open={!!outputRun}
        onClose={() => setOutputRun(null)}
        width={720}
      >
        {outputRun && (
          <>
            <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Playbook ID">{outputRun.playbook_id}</Descriptions.Item>
              <Descriptions.Item label="Job Template">{outputRun.job_template_id ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Created">{new Date(outputRun.created_at).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="Status"><Tag>{outputRun.status}</Tag></Descriptions.Item>
            </Descriptions>
            <PlaybookRunOutput
              runId={outputRun.id}
              initialOutput={outputRun.output}
              initialStatus={outputRun.status}
              onStatusChange={syncOutputRunStatus}
            />
          </>
        )}
      </Drawer>

      <Drawer
        title={historyTemplate ? `Recent Runs · ${historyTemplate.name}` : "Recent Runs"}
        open={!!historyTemplate}
        onClose={() => setHistoryTemplate(null)}
        width={640}
      >
        <Table<PlaybookRun>
          rowKey="id"
          dataSource={historyRuns?.items ?? []}
          pagination={false}
          columns={[
            { title: "Run", dataIndex: "id", render: (value: number) => `#${value}` },
            { title: "Status", dataIndex: "status" },
            { title: "Created", dataIndex: "created_at", render: (value: string) => new Date(value).toLocaleString() },
            {
              title: "",
              render: (_: unknown, run: PlaybookRun) => (
                <Button size="small" icon={<EyeOutlined />} onClick={() => setOutputRun(run)} />
              ),
            },
          ]}
        />
      </Drawer>
    </div>
  );
}

function HostPreviewLens({ preview, selectedHost }: { preview: JobTemplatePreview; selectedHost: JobTemplatePreviewHost | null }) {
  if (!selectedHost) {
    return <Empty description="Select a host to inspect why it matched and what stays dynamic." />;
  }

  const matchedPlays = preview.plays.filter((play) =>
    play.host_matches.some((hostMatch) => hostMatch.host_id === selectedHost.host_id)
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          borderRadius: 14,
          padding: 14,
          border: "1px solid var(--ant-color-border-secondary)",
          background: "var(--ant-color-fill-quaternary)",
        }}
      >
        <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
          <div>
            <Typography.Text strong>{selectedHost.hostname}</Typography.Text>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{selectedHost.ipv4 ?? "no IP"}</div>
          </div>
          <Tag color="blue">{matchedPlays.length} plays</Tag>
        </Space>
        <div style={{ marginTop: 10, fontSize: 13 }}>
          {selectedHost.filter_reason ?? "Included in the template target set."}
        </div>
        <div style={{ marginTop: 10 }}>
          <Space wrap size={[4, 4]}>
            {selectedHost.groups.map((group) => (
              <Tag key={group}>{group}</Tag>
            ))}
          </Space>
        </div>
      </div>

      {matchedPlays.length === 0 ? (
        <Alert type="warning" showIcon message="This host is in the filtered target set but did not match any static play hosts pattern." />
      ) : (
        <Collapse
          bordered={false}
          items={matchedPlays.map((play, index) => {
            const hostMatch = play.host_matches.find((item) => item.host_id === selectedHost.host_id);
            return {
              key: `${index}-${play.name}-${selectedHost.host_id}`,
              label: (
                <Space wrap>
                  <Typography.Text strong>{play.name}</Typography.Text>
                  <Tag color="purple">{play.hosts_pattern}</Tag>
                  <Tag color={play.confidence === "direct" ? "green" : play.confidence === "dynamic" ? "orange" : "red"}>
                    {play.confidence}
                  </Tag>
                </Space>
              ),
              children: (
                <div style={{ display: "grid", gap: 12 }}>
                  <div
                    style={{
                      borderRadius: 12,
                      padding: 12,
                      border: "1px solid var(--ant-color-border-secondary)",
                      background: "var(--ant-color-fill-quaternary)",
                    }}
                  >
                    <Typography.Text strong>Why this host matched</Typography.Text>
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      {hostMatch?.target_reason ?? `Matched play hosts pattern: ${play.hosts_pattern}`}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Space wrap size={[4, 4]}>
                        {(hostMatch?.matched_by ?? []).map((token) => (
                          <Tag key={token}>{token}</Tag>
                        ))}
                        {(hostMatch?.matched_groups ?? []).map((group) => (
                          <Tag key={group} color="purple">{group}</Tag>
                        ))}
                      </Space>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {play.tasks.map((task, taskIndex) => (
                      <TaskPreviewTree key={`${play.name}-${taskIndex}-${task.name}-${selectedHost.host_id}`} task={task} depth={0} />
                    ))}
                  </div>
                </div>
              ),
            };
          })}
        />
      )}
    </div>
  );
}

function TaskPreviewTree({ task, depth }: { task: JobTemplatePreviewTask; depth: number }) {
  return (
    <div
      style={{
        borderRadius: 14,
        padding: 12,
        marginLeft: depth * 18,
        border: "1px solid var(--ant-color-border-secondary)",
        background: depth === 0 ? "var(--ant-color-fill-quaternary)" : "var(--ant-color-bg-container)",
      }}
    >
      <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
        <Space wrap>
          <Typography.Text strong>{task.name}</Typography.Text>
          <Tag>{task.kind}</Tag>
          <Tag color={task.confidence === "direct" ? "green" : task.confidence === "dynamic" ? "orange" : "red"}>
            {task.confidence}
          </Tag>
          {task.tags.map((tag) => (
            <Tag key={tag} color="blue">
              {tag}
            </Tag>
          ))}
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {task.source_path}
        </Typography.Text>
      </Space>
      {task.dynamic_reason ? (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.88 }}>
          {task.dynamic_reason}
        </div>
      ) : null}
      {task.children.length > 0 && (
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {task.children.map((child, index) => (
            <TaskPreviewTree key={`${child.name}-${index}-${depth + 1}`} task={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
  function normalizeInventoryFilters(filters?: InventoryFilters | null): InventoryFilters {
    return {
      environment_ids: filters?.environment_ids?.length ? filters.environment_ids : undefined,
      role_ids: filters?.role_ids?.length ? filters.role_ids : undefined,
      status_ids: filters?.status_ids?.length ? filters.status_ids : undefined,
      vlan_ids: filters?.vlan_ids?.length ? filters.vlan_ids : undefined,
      host_ids: filters?.host_ids?.length ? filters.host_ids : undefined,
      pattern: filters?.pattern?.trim() ? filters.pattern.trim() : null,
    };
  }

function legacyFilterToObject(template: Pick<JobTemplate, "inventory_filter_type" | "inventory_filter_value" | "inventory_filters">): InventoryFilters {
    if (template.inventory_filters) {
      return normalizeInventoryFilters(template.inventory_filters);
    }
    const filters: InventoryFilters = {};
    const value = template.inventory_filter_value;
    if (template.inventory_filter_type === "environment") {
      filters.environment_ids = typeof value === "number" ? [value] : Array.isArray(value) ? value.map(Number) : undefined;
    } else if (template.inventory_filter_type === "role") {
      filters.role_ids = typeof value === "number" ? [value] : Array.isArray(value) ? value.map(Number) : undefined;
    } else if (template.inventory_filter_type === "status") {
      filters.status_ids = typeof value === "number" ? [value] : Array.isArray(value) ? value.map(Number) : undefined;
    } else if (template.inventory_filter_type === "vlan") {
      filters.vlan_ids = typeof value === "number" ? [value] : Array.isArray(value) ? value.map(Number) : undefined;
    } else if (template.inventory_filter_type === "hosts") {
      filters.host_ids = Array.isArray(value) ? value.map(Number) : typeof value === "number" ? [value] : undefined;
    } else if (template.inventory_filter_type === "pattern") {
      filters.pattern = typeof value === "string" ? value : null;
  }
  return normalizeInventoryFilters(filters);
}

function inventoryFilterSummary(template: Pick<JobTemplate, "inventory_filter_type" | "inventory_filter_value" | "inventory_filters">): string {
  const filters = legacyFilterToObject(template);
  const parts: string[] = [];
  if (filters.environment_ids?.length) parts.push(`env ${filters.environment_ids.length}`);
  if (filters.role_ids?.length) parts.push(`roles ${filters.role_ids.length}`);
  if (filters.status_ids?.length) parts.push(`status ${filters.status_ids.length}`);
  if (filters.vlan_ids?.length) parts.push(`vlan ${filters.vlan_ids.length}`);
  if (filters.host_ids?.length) parts.push(`hosts ${filters.host_ids.length}`);
  if (filters.pattern) parts.push("pattern");
  return parts.length ? parts.join(" + ") : "all";
}
