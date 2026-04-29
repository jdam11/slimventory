import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Input,
  Modal,
  Progress,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
  theme as antdTheme,
} from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  BorderOutlined,
  CheckSquareOutlined,
  LockOutlined,
} from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import * as jsyaml from "js-yaml";
import { bulkImport, bulkPreviewImport } from "../api/git";
import { useSessionState } from "../hooks/useSessionState";
import type { AppImportField, BulkAppImportItem, BulkAppImportPreview, GitRepo } from "../types";

const { Text, Title } = Typography;

type EditMode = "yaml" | "fields";
type Phase = "select" | "edit";

interface EditablePreview extends BulkAppImportPreview {
  key: string;
  selected: boolean;
  appName: string;
}

interface Props {
  repo: GitRepo | null;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}


function fieldsToYaml(fields: AppImportField[]): string {
  if (fields.length === 0) return "---\n";
  const obj: Record<string, string | null> = {};
  for (const f of fields) obj[f.name] = f.default_value ?? null;
  return "---\n" + jsyaml.dump(obj, { lineWidth: -1 });
}

function parseYamlToFields(
  text: string,
  original: AppImportField[]
): AppImportField[] {
  const raw = jsyaml.load(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("YAML must be a key: value mapping");
  }
  const secretNames = new Set(original.filter((f) => f.is_secret_hint).map((f) => f.name));
  return Object.entries(raw as Record<string, unknown>).map(([name, val]) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`"${name}" is not a valid Ansible variable name`);
    }
    return {
      name,
      default_value: val === null || val === undefined ? null : String(val),
      is_secret_hint: secretNames.has(name),
    };
  });
}


interface AppFieldEditorProps {
  item: EditablePreview;
  editMode: EditMode;
  yamlDraft: string;
  onYamlChange: (v: string) => void;
  onFieldChange: (fields: AppImportField[]) => void;
  parseError: string | null;
}

function AppFieldEditor({
  item,
  editMode,
  yamlDraft,
  onYamlChange,
  onFieldChange,
  parseError,
}: AppFieldEditorProps) {
  const { token } = antdTheme.useToken();

  if (item.fields.length === 0) {
    return (
      <Text type="secondary" style={{ display: "block", padding: "24px 0", textAlign: "center" }}>
        No default vars defined for this app.
      </Text>
    );
  }

  if (editMode === "yaml") {
    return (
      <>
        {parseError && <Alert type="error" message={parseError} showIcon style={{ marginBottom: 8 }} />}
        <textarea
          value={yamlDraft}
          onChange={(e) => onYamlChange(e.target.value)}
          spellCheck={false}
          style={{
            width: "100%",
            minHeight: 220,
            fontFamily: "monospace",
            fontSize: 13,
            padding: "8px 10px",
            borderRadius: token.borderRadius,
            border: `1px solid ${parseError ? token.colorError : token.colorBorder}`,
            background: token.colorBgContainer,
            color: token.colorText,
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </>
    );
  }

  // fields mode
  return (
    <Space direction="vertical" size={6} style={{ width: "100%" }}>
      {parseError && <Alert type="error" message={parseError} showIcon />}
      {item.fields.map((field, idx) => (
        <div
          key={field.name}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.6fr",
            gap: 8,
            alignItems: "center",
          }}
        >
          <Space size={4}>
            {field.is_secret_hint && (
              <Tooltip title="Secret / sensitive value">
                <LockOutlined style={{ color: token.colorWarning, fontSize: 12 }} />
              </Tooltip>
            )}
            <Text code style={{ fontSize: 12 }}>
              {field.name}
            </Text>
          </Space>
          <Input
            size="small"
            value={field.default_value ?? ""}
            placeholder="null"
            onChange={(e) => {
              const updated = item.fields.map((f, i) =>
                i === idx
                  ? { ...f, default_value: e.target.value === "" ? null : e.target.value }
                  : f
              );
              onFieldChange(updated);
            }}
          />
        </div>
      ))}
    </Space>
  );
}


interface EditWizardProps {
  items: EditablePreview[];
  onBack: () => void;
  onFinish: (items: EditablePreview[]) => void;
  loading: boolean;
}

function EditWizard({ items, onBack, onFinish, loading }: EditWizardProps) {
  const [editMode, setEditMode] = useSessionState<EditMode>("bulk-app-import-edit-mode", "fields");
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<EditablePreview[]>(() =>
    items.map((item) => ({ ...item, fields: [...item.fields] }))
  );
  // YAML draft per app index
  const [yamlDrafts, setYamlDrafts] = useState<string[]>(() =>
    items.map((item) => fieldsToYaml(item.fields))
  );
  const [parseError, setParseError] = useState<string | null>(null);

  const current = drafts[index];
  const total = drafts.length;
  const isLast = index === total - 1;

  function setYamlDraft(idx: number, val: string) {
    setYamlDrafts((prev) => prev.map((v, i) => (i === idx ? val : v)));
    setParseError(null);
  }

  function setFieldsForIndex(idx: number, fields: AppImportField[]) {
    setDrafts((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, fields } : item))
    );
  }

  function switchMode(next: EditMode) {
    setParseError(null);
    if (next === editMode) return;
    if (next === "yaml") {
      // fields → yaml: serialize current fields
      setYamlDraft(index, fieldsToYaml(drafts[index].fields));
    } else {
      // yaml → fields: parse current yaml
      try {
        const fields = parseYamlToFields(yamlDrafts[index], items[index].fields);
        setFieldsForIndex(index, fields);
      } catch (err) {
        setParseError((err as Error).message);
        return;
      }
    }
    setEditMode(next);
  }

  function commitCurrentAndGo(nextIdx: number) {
    setParseError(null);
    if (editMode === "yaml" && current.fields.length > 0) {
      try {
        const fields = parseYamlToFields(yamlDrafts[index], items[index].fields);
        setFieldsForIndex(index, fields);
        // update yaml draft to normalized form
        setYamlDraft(index, fieldsToYaml(fields));
        // proceed with updated drafts
        const updated = drafts.map((item, i) => (i === index ? { ...item, fields } : item));
        if (nextIdx >= total) {
          onFinish(updated);
        } else {
          setDrafts(updated);
          setIndex(nextIdx);
        }
        return;
      } catch (err) {
        setParseError((err as Error).message);
        return;
      }
    }
    if (nextIdx >= total) {
      onFinish(drafts);
    } else {
      setIndex(nextIdx);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {/* Progress header */}
      <Space direction="vertical" size={4} style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Title level={5} style={{ margin: 0 }}>
            {current.appName || current.suggested_name}
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {index + 1} / {total}
          </Text>
        </div>
        <Progress
          percent={Math.round(((index + 1) / total) * 100)}
          showInfo={false}
          size="small"
        />
        <Text type="secondary" style={{ fontSize: 11 }}>
          {current.subpath}
          {current.category && (
            <Tag style={{ marginLeft: 6 }} color="blue">{current.category}</Tag>
          )}
        </Text>
      </Space>

      {/* Mode toggle */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Segmented
          size="small"
          value={editMode}
          onChange={(v) => switchMode(v as EditMode)}
          options={[
            { label: "Fields", value: "fields" },
            { label: "YAML", value: "yaml" },
          ]}
        />
      </div>

      {/* Field editor */}
      <AppFieldEditor
        item={{ ...current, fields: drafts[index].fields }}
        editMode={editMode}
        yamlDraft={yamlDrafts[index]}
        onYamlChange={(v) => setYamlDraft(index, v)}
        onFieldChange={(fields) => setFieldsForIndex(index, fields)}
        parseError={parseError}
      />

      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            Back to selection
          </Button>
          {index > 0 && (
            <Button onClick={() => setIndex(index - 1)}>Previous</Button>
          )}
        </Space>
        <Button
          type="primary"
          loading={loading && isLast}
          icon={!isLast ? <ArrowRightOutlined /> : undefined}
          iconPosition="end"
          onClick={() => commitCurrentAndGo(index + 1)}
        >
          {isLast ? "Import" : "Next"}
        </Button>
      </div>
    </Space>
  );
}


export default function BulkAppImportModal({ repo, open, onClose, onImported }: Props) {
  const { token } = antdTheme.useToken();
  const [phase, setPhase] = useState<Phase>("select");
  const [items, setItems] = useState<EditablePreview[]>([]);

  const previewMutation = useMutation({
    mutationFn: async (repoId: number) => bulkPreviewImport(repoId),
    onSuccess: (data) => {
      setItems(
        data.map((item) => ({
          ...item,
          key: item.subpath,
          selected: true,
          appName: item.suggested_name,
        }))
      );
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail ?? "Failed to preview bulk import.");
    },
  });

  const importMutation = useMutation({
    mutationFn: (payload: BulkAppImportItem[]) => bulkImport(repo!.id, payload),
    onSuccess: (result) => {
      message.success(`Imported ${result.created_apps} app(s).`);
      onImported();
      onClose();
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail ?? "Bulk import failed.");
    },
  });

  useEffect(() => {
    if (open && repo) {
      previewMutation.mutate(repo.id);
      setPhase("select");
    } else if (!open) {
      setItems([]);
      setPhase("select");
    }
  }, [open, repo]);

  const grouped = useMemo(() => {
    const groups = new Map<string, EditablePreview[]>();
    for (const item of items) {
      const key = item.category ?? "Uncategorized";
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return Array.from(groups.entries());
  }, [items]);

  function updateItem(key: string, patch: Partial<EditablePreview>) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  const selectedItems = items.filter((i) => i.selected);
  const selectedCount = selectedItems.length;

  function selectAll() {
    setItems((prev) => prev.map((item) => ({ ...item, selected: true })));
  }

  function selectNone() {
    setItems((prev) => prev.map((item) => ({ ...item, selected: false })));
  }

  function selectCategory(category: string, checked: boolean) {
    setItems((prev) =>
      prev.map((item) => (item.category === category ? { ...item, selected: checked } : item))
    );
  }

  function doImport(finalItems: EditablePreview[]) {
    const payload: BulkAppImportItem[] = finalItems
      .filter((item) => item.selected)
      .map((item) => ({
        app_name: item.appName.trim(),
        category: item.category,
        subpath: item.subpath,
        fields: item.fields,
      }));
    if (payload.length === 0) {
      message.error("Select at least one app to import.");
      return;
    }
    importMutation.mutate(payload);
  }

  function handleImportNow() {
    doImport(items);
  }

  function handleFinishWizard(finalItems: EditablePreview[]) {
    // Merge wizard edits back into items list
    const byKey = new Map(finalItems.map((i) => [i.key, i]));
    const merged = items.map((item) => byKey.get(item.key) ?? item);
    doImport(merged);
  }

  const hasAnyFields = selectedItems.some((i) => i.fields.length > 0);

  const selectPhaseFooter = (
    <Space style={{ width: "100%", justifyContent: "space-between", display: "flex" }}>
      <Button onClick={onClose}>Cancel</Button>
      <Space>
        <Button
          onClick={handleImportNow}
          loading={importMutation.isPending}
          disabled={selectedCount === 0}
        >
          Import Now
        </Button>
        {hasAnyFields && (
          <Button
            type="primary"
            disabled={selectedCount === 0}
            onClick={() => {
              if (selectedCount === 0) {
                message.error("Select at least one app.");
                return;
              }
              setPhase("edit");
            }}
          >
            Review Defaults →
          </Button>
        )}
        {!hasAnyFields && (
          <Button
            type="primary"
            onClick={handleImportNow}
            loading={importMutation.isPending}
            disabled={selectedCount === 0}
          >
            Import Selected
          </Button>
        )}
      </Space>
    </Space>
  );

  return (
    <Modal
      title={
        phase === "select"
          ? repo ? `Bulk Import Apps from "${repo.name}"` : "Bulk Import Apps"
          : `Review Defaults — ${selectedCount} app${selectedCount !== 1 ? "s" : ""}`
      }
      open={open}
      onCancel={onClose}
      footer={phase === "select" ? selectPhaseFooter : null}
      width={820}
    >
      {previewMutation.isPending ? (
        <Space direction="vertical" align="center" style={{ width: "100%", padding: 32 }}>
          <Spin />
          <Text>Scanning app directories…</Text>
        </Space>
      ) : phase === "edit" ? (
        <EditWizard
          items={selectedItems}
          onBack={() => setPhase("select")}
          onFinish={handleFinishWizard}
          loading={importMutation.isPending}
        />
      ) : items.length > 0 ? (
        <>
          <Space style={{ marginBottom: 12 }}>
            <Text type="secondary">{selectedCount} / {items.length} selected</Text>
            <Button size="small" icon={<CheckSquareOutlined />} onClick={selectAll}>All</Button>
            <Button size="small" icon={<BorderOutlined />} onClick={selectNone}>None</Button>
          </Space>
          <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            <Collapse
              items={grouped.map(([category, categoryItems]) => {
                const catSelected = categoryItems.filter((i) => i.selected).length;
                const allCatSelected = catSelected === categoryItems.length;
                return {
                  key: category,
                  label: (
                    <Space>
                      <Checkbox
                        checked={allCatSelected}
                        indeterminate={catSelected > 0 && !allCatSelected}
                        onChange={(e) => { e.stopPropagation(); selectCategory(category === "Uncategorized" ? category : category, e.target.checked); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span>{category} ({catSelected}/{categoryItems.length})</span>
                    </Space>
                  ),
                  children: (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      {categoryItems.map((item) => (
                        <div
                          key={item.key}
                          style={{
                            border: `1px solid ${token.colorBorder}`,
                            borderRadius: token.borderRadius,
                            padding: 12,
                          }}
                        >
                          <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
                            <Checkbox
                              checked={item.selected}
                              onChange={(e) => updateItem(item.key, { selected: e.target.checked })}
                            />
                            <Input
                              value={item.appName}
                              onChange={(e) => updateItem(item.key, { appName: e.target.value })}
                              style={{ maxWidth: 280 }}
                            />
                            <Text type="secondary" style={{ fontSize: 11 }}>{item.subpath}</Text>
                          </Space>
                          {item.fields.length > 0 && (
                            <Space style={{ marginTop: 8 }} size={4}>
                              <Badge count={item.fields.length} color={token.colorPrimary} />
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {item.fields.length} default var{item.fields.length !== 1 ? "s" : ""} —
                                use <Text strong style={{ fontSize: 11 }}>Review Defaults</Text> to edit
                              </Text>
                              {item.fields.some((f) => f.is_secret_hint) && (
                                <Tag icon={<LockOutlined />} color="warning" style={{ fontSize: 11 }}>
                                  has secrets
                                </Tag>
                              )}
                            </Space>
                          )}
                        </div>
                      ))}
                    </Space>
                  ),
                };
              })}
            />
          </div>
        </>
      ) : null}
    </Modal>
  );
}
