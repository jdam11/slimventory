import {
  CloudDownloadOutlined,
  FieldStringOutlined,
  SyncOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Form,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import * as jsyaml from "js-yaml";
import api from "../../api/client";
import { listRecords } from "../../api/crud";
import { listGitRepos, syncGitRepo } from "../../api/git";
import BulkAppImportModal from "../../components/BulkAppImportModal";
import CrudPage from "../../components/CrudPage";
import type { App, AppField, GitRepo } from "../../types";
import { buildSortedOptions, filterSelectOption } from "../../utils/selectOptions";

const { Text } = Typography;

const COLUMNS = [
  { title: "Name", dataIndex: "name", key: "name", width: 200 },
  { title: "Description", dataIndex: "description", key: "description" },
];

const FIELDS = [
  { key: "name", label: "Name", type: "text" as const, required: true },
  { key: "description", label: "Description", type: "text" as const },
];

// Convert AppField list → YAML string (name: default_value)
function fieldsToYaml(fields: AppField[]): string {
  if (fields.length === 0) return "---\n";
  const obj: Record<string, string | null> = {};
  for (const f of fields) {
    obj[f.name] = f.default_value ?? null;
  }
  return "---\n" + jsyaml.dump(obj, { lineWidth: -1 });
}

// Parse YAML string → { name: default_value } dict (all values cast to string)
function parseYaml(text: string): Record<string, string | null> {
  const raw = jsyaml.load(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("YAML must be a mapping (key: value pairs)");
  }
  const result: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) {
      throw new Error(`"${k}" is not a valid Ansible variable name`);
    }
    result[k] = v === null || v === undefined ? null : String(v);
  }
  return result;
}

function AppFieldsModal({
  app,
  onClose,
  onPrevious,
  onNext,
}: {
  app: App;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const qc = useQueryClient();
  const queryKey = [`/app-fields?app_id=${app.id}`];
  const [yamlText, setYamlText] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setYamlText(null);
    setParseError(null);
  }, [app.id]);

  const { data: fields = [], isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      api
        .get<AppField[]>("/app-fields", { params: { app_id: app.id } })
        .then((r) => r.data),
    select: (data) => {
      // Initialise editor text once on first load
      if (yamlText === null) {
        setYamlText(fieldsToYaml(data));
      }
      return data;
    },
  });

  const saveMut = useMutation({
    mutationFn: (fieldsMap: Record<string, string | null>) =>
      api.put(`/app-fields/yaml/${app.id}`, { fields: fieldsMap }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      message.success("Fields saved");
    },
    onError: (e: unknown) =>
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? "Save failed"
      ),
  });

  function handleSave() {
    setParseError(null);
    try {
      const parsed = parseYaml(yamlText ?? "");
      saveMut.mutate(parsed);
    } catch (err) {
      setParseError((err as Error).message);
    }
  }

  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setParseError(null);
      try {
        // Validate before setting
        parseYaml(text);
        setYamlText(text);
      } catch (err) {
        setParseError((err as Error).message);
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported
    e.target.value = "";
  }

  const editorValue = yamlText ?? (isFetching ? "" : fieldsToYaml(fields));

  return (
    <Modal
      title={
        <span>
          Fields (YAML defaults) for <Tag color="blue">{app.name}</Tag>
        </span>
      }
      open
      width={640}
      onCancel={onClose}
      destroyOnClose
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
          <Space>
            <Button onClick={onPrevious} disabled={!onPrevious}>
              Previous
            </Button>
            <Button onClick={onNext} disabled={!onNext}>
              Next
            </Button>
          </Space>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              type="primary"
              loading={saveMut.isPending}
              onClick={handleSave}
            >
              Save
            </Button>
          </Space>
        </div>
      }
    >
      <Space direction="vertical" style={{ width: "100%", marginBottom: 8 }}>
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Each key is an Ansible variable name; the value is its default.
            Host-level overrides take precedence.
          </Text>
          <Button
            size="small"
            icon={<UploadOutlined />}
            onClick={() => fileInputRef.current?.click()}
          >
            Import YAML file
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yml,.yaml,.txt"
            style={{ display: "none" }}
            onChange={handleFileImport}
          />
        </Space>
        {parseError && (
          <Alert type="error" message={parseError} showIcon />
        )}
      </Space>
      <textarea
        value={editorValue}
        onChange={(e) => {
          setYamlText(e.target.value);
          setParseError(null);
        }}
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: 340,
          fontFamily: "monospace",
          fontSize: 13,
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid #d9d9d9",
          background: "#1e1e1e",
          color: "#d4d4d4",
          resize: "vertical",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </Modal>
  );
}

function RepoImportButton({ onImported }: { onImported: () => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [bulkRepo, setBulkRepo] = useState<GitRepo | null>(null);
  const [syncing, setSyncing] = useState(false);

  const { data: reposData } = useQuery({
    queryKey: ["/git-repos"],
    queryFn: () => listGitRepos(0, 200),
    enabled: pickerOpen,
  });

  const appRepos = (reposData?.items ?? []).filter((r) => r.repo_type === "app");
  const selectedRepo = appRepos.find((r) => r.id === selectedRepoId) ?? null;

  async function handleSync() {
    if (!selectedRepo) return;
    setSyncing(true);
    try {
      await syncGitRepo(selectedRepo.id);
      message.success("Synced — ready to import");
    } catch {
      message.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  function handleOpenImport() {
    if (!selectedRepo) return;
    setPickerOpen(false);
    setBulkRepo(selectedRepo);
  }

  return (
    <>
      <Button icon={<CloudDownloadOutlined />} onClick={() => setPickerOpen(true)}>
        Import from Repo
      </Button>

      <Modal
        title="Import Apps from Git Repo"
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setPickerOpen(false)}>Cancel</Button>
            <Tooltip title={selectedRepo && !selectedRepo.last_synced_at ? "Sync repo first" : ""}>
              <Button
                type="primary"
                disabled={!selectedRepo}
                onClick={handleOpenImport}
              >
                Choose Apps
              </Button>
            </Tooltip>
          </Space>
        }
        width={480}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select
            style={{ width: "100%" }}
            placeholder="Select a repo…"
            value={selectedRepoId ?? undefined}
            onChange={(v) => setSelectedRepoId(v)}
            showSearch
            filterOption={filterSelectOption}
            options={buildSortedOptions(appRepos, (r) => ({
              value: r.id,
              label: `${r.name}${r.last_synced_at ? " (synced)" : " (not synced)"}`,
              searchText: r.name,
            }))}
          />
          {selectedRepo && (
            <Button
              icon={<SyncOutlined spin={syncing} />}
              loading={syncing}
              onClick={handleSync}
              style={{ width: "100%" }}
            >
              {selectedRepo.last_synced_at ? "Re-sync repo" : "Sync repo (required before import)"}
            </Button>
          )}
        </Space>
      </Modal>

      <BulkAppImportModal
        repo={bulkRepo}
        open={!!bulkRepo}
        onClose={() => setBulkRepo(null)}
        onImported={() => {
          setBulkRepo(null);
          onImported();
        }}
      />
    </>
  );
}

export default function AppsPage() {
  const [fieldsApp, setFieldsApp] = useState<App | null>(null);
  const { data: appsData } = useQuery({
    queryKey: ["/apps", "field-editor-nav"],
    queryFn: () => listRecords<App>("/apps", 0, 500),
  });
  const apps = appsData?.items ?? [];
  const currentIndex = fieldsApp ? apps.findIndex((app) => app.id === fieldsApp.id) : -1;
  const previousApp = currentIndex > 0 ? apps[currentIndex - 1] : null;
  const nextApp = currentIndex >= 0 && currentIndex < apps.length - 1 ? apps[currentIndex + 1] : null;

  const [modalYaml, setModalYaml] = useState("---\n");
  const [modalYamlError, setModalYamlError] = useState<string | null>(null);
  const modalFileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  function handleModalOpen(editing: App | null) {
    setModalYamlError(null);
    if (editing) {
      api
        .get<AppField[]>("/app-fields", { params: { app_id: editing.id } })
        .then((r) => setModalYaml(fieldsToYaml(r.data)))
        .catch(() => setModalYaml("---\n"));
    } else {
      setModalYaml("---\n");
    }
  }

  function handleModalFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setModalYamlError(null);
      try {
        parseYaml(text);
        setModalYaml(text);
      } catch (err) {
        setModalYamlError((err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function validateModalYaml(): string | null {
    try {
      parseYaml(modalYaml);
      return null;
    } catch (err) {
      const msg = (err as Error).message;
      setModalYamlError(msg);
      return msg;
    }
  }

  async function saveModalYaml(app: App) {
    try {
      const fields = parseYaml(modalYaml);
      await api.put(`/app-fields/yaml/${app.id}`, { fields });
      qc.invalidateQueries({ queryKey: [`/app-fields?app_id=${app.id}`] });
    } catch (err) {
      message.error("App saved but fields could not be saved: " + (err as Error).message);
    }
  }

  const modalYamlEditor = (
    <Form.Item label="Fields (YAML defaults)" style={{ marginBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Text type="secondary" style={{ fontSize: 12, flex: 1 }}>
          Keys are Ansible variable names; values are defaults (host overrides take precedence).
        </Text>
        <Button
          size="small"
          icon={<UploadOutlined />}
          onClick={() => modalFileRef.current?.click()}
        >
          Import YAML
        </Button>
        <input
          ref={modalFileRef}
          type="file"
          accept=".yml,.yaml,.txt"
          style={{ display: "none" }}
          onChange={handleModalFileImport}
        />
      </div>
      {modalYamlError && (
        <Alert
          type="error"
          message={modalYamlError}
          showIcon
          style={{ marginBottom: 6 }}
        />
      )}
      <textarea
        value={modalYaml}
        onChange={(e) => {
          setModalYaml(e.target.value);
          setModalYamlError(null);
        }}
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: 220,
          fontFamily: "monospace",
          fontSize: 13,
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid #d9d9d9",
          background: "#1e1e1e",
          color: "#d4d4d4",
          resize: "vertical",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </Form.Item>
  );

  return (
    <>
      <CrudPage<App>
        title="Apps"
        endpoint="/apps"
        columns={COLUMNS}
        formFields={FIELDS}
        rowKey="id"
        onModalOpen={handleModalOpen}
        extraModalContent={modalYamlEditor}
        onBeforeSubmit={validateModalYaml}
        onAfterCreate={saveModalYaml}
        onAfterUpdate={saveModalYaml}
        extraHeaderButtons={
          <RepoImportButton onImported={() => qc.invalidateQueries({ queryKey: ["/apps"] })} />
        }
        extraActions={(record) => (
          <Button
            size="small"
            icon={<FieldStringOutlined />}
            onClick={() => setFieldsApp(record)}
          >
            Fields
          </Button>
        )}
      />
      {fieldsApp && (
        <AppFieldsModal
          app={fieldsApp}
          onClose={() => setFieldsApp(null)}
          onPrevious={previousApp ? () => setFieldsApp(previousApp) : undefined}
          onNext={nextApp ? () => setFieldsApp(nextApp) : undefined}
        />
      )}
    </>
  );
}
