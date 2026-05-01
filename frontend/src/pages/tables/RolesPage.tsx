import {
  FieldStringOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Input,
  Modal,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
  theme as antdTheme,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import * as jsyaml from "js-yaml";
import api from "../../api/client";
import { listRecords } from "../../api/crud";
import CrudPage from "../../components/CrudPage";
import { useSessionState } from "../../hooks/useSessionState";
import type { Role, RoleField } from "../../types";

const { Text } = Typography;

const COLUMNS = [
  { title: "Name", dataIndex: "name", key: "name", width: 200 },
  { title: "Description", dataIndex: "description", key: "description" },
];

const FIELDS = [
  { key: "name", label: "Name", type: "text" as const, required: true },
  { key: "description", label: "Description", type: "text" as const },
];

type EditMode = "yaml" | "fields";

function fieldsToYaml(fields: RoleField[]): string {
  if (fields.length === 0) return "---\n";
  const obj: Record<string, string | null> = {};
  for (const f of fields) {
    obj[f.name] = f.default_value ?? null;
  }
  return "---\n" + jsyaml.dump(obj, { lineWidth: -1 });
}

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

function yamlToFieldRows(text: string): Array<{ name: string; value: string }> {
  const parsed = parseYaml(text);
  return Object.entries(parsed).map(([name, value]) => ({ name, value: value ?? "" }));
}

function fieldRowsToYaml(rows: Array<{ name: string; value: string }>): string {
  if (rows.length === 0) return "---\n";
  const obj: Record<string, string | null> = {};
  for (const r of rows) {
    obj[r.name] = r.value === "" ? null : r.value;
  }
  return "---\n" + jsyaml.dump(obj, { lineWidth: -1 });
}

function RoleFieldsModal({
  role,
  onClose,
  onPrevious,
  onNext,
}: {
  role: Role;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const { token } = antdTheme.useToken();
  const qc = useQueryClient();
  const queryKey = [`/role-fields?role_id=${role.id}`];
  const [editMode, setEditMode] = useSessionState<EditMode>("role-fields-edit-mode", "yaml");
  const [yamlText, setYamlText] = useState<string | null>(null);
  const [fieldRows, setFieldRows] = useState<Array<{ name: string; value: string }> | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setYamlText(null);
    setFieldRows(null);
    setParseError(null);
  }, [role.id]);

  const { data: fields = [], isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      api
        .get<RoleField[]>("/role-fields", { params: { role_id: role.id } })
        .then((r) => r.data),
    select: (data) => {
      if (yamlText === null && fieldRows === null) {
        setYamlText(fieldsToYaml(data));
        setFieldRows(data.map((f) => ({ name: f.name, value: f.default_value ?? "" })));
      }
      return data;
    },
  });

  const saveMut = useMutation({
    mutationFn: (fieldsMap: Record<string, string | null>) =>
      api.put(`/role-fields/yaml/${role.id}`, { fields: fieldsMap }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["/role-fields"] });
      message.success("Fields saved");
    },
    onError: (e: unknown) =>
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? "Save failed"
      ),
  });

  function switchMode(next: EditMode) {
    setParseError(null);
    if (next === editMode) return;
    if (next === "fields") {
      // yaml → fields
      try {
        const rows = yamlToFieldRows(yamlText ?? "---\n");
        setFieldRows(rows);
        setEditMode("fields");
      } catch (err) {
        setParseError((err as Error).message);
      }
    } else {
      // fields → yaml
      const yaml = fieldRowsToYaml(fieldRows ?? []);
      setYamlText(yaml);
      setEditMode("yaml");
    }
  }

  function handleSave() {
    setParseError(null);
    try {
      let parsed: Record<string, string | null>;
      if (editMode === "yaml") {
        parsed = parseYaml(yamlText ?? "---\n");
      } else {
        const rows = fieldRows ?? [];
        parsed = {};
        for (const r of rows) {
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(r.name)) {
            throw new Error(`"${r.name}" is not a valid Ansible variable name`);
          }
          parsed[r.name] = r.value === "" ? null : r.value;
        }
      }
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
        parseYaml(text);
        setYamlText(text);
        setFieldRows(yamlToFieldRows(text));
        setEditMode("yaml");
      } catch (err) {
        setParseError((err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function addRow() {
    setFieldRows((prev) => [...(prev ?? []), { name: "", value: "" }]);
  }

  function removeRow(idx: number) {
    setFieldRows((prev) => (prev ?? []).filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, patch: Partial<{ name: string; value: string }>) {
    setFieldRows((prev) =>
      (prev ?? []).map((r, i) => (i === idx ? { ...r, ...patch } : r))
    );
  }

  const editorYaml = yamlText ?? (isFetching ? "" : fieldsToYaml(fields));
  const editorRows = fieldRows ?? (isFetching ? [] : fields.map((f) => ({ name: f.name, value: f.default_value ?? "" })));

  return (
    <Modal
      title={
        <span>
          Fields (YAML defaults) for role <Tag color="purple">{role.name}</Tag>
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
      <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }} size={8}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Each key is an Ansible variable name; the value is its default for all hosts
            with this role. Host-level overrides take precedence.
          </Text>
          <Space size={6} style={{ flexShrink: 0 }}>
            <Segmented
              size="small"
              value={editMode}
              onChange={(v) => switchMode(v as EditMode)}
              options={[
                { label: "YAML", value: "yaml" },
                { label: "Fields", value: "fields" },
              ]}
            />
            <Tooltip title="Import YAML file">
              <Button
                size="small"
                icon={<UploadOutlined />}
                onClick={() => fileInputRef.current?.click()}
              />
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              accept=".yml,.yaml,.txt"
              style={{ display: "none" }}
              onChange={handleFileImport}
            />
          </Space>
        </div>
        {parseError && (
          <Alert type="error" message={parseError} showIcon />
        )}
      </Space>

      {editMode === "yaml" ? (
        <textarea
          value={editorYaml}
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
            borderRadius: token.borderRadius,
            border: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
            color: token.colorText,
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={6}>
          {editorRows.length === 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>No fields yet. Add one below.</Text>
          )}
          {editorRows.map((row, idx) => (
            <Space key={idx} style={{ width: "100%" }} size={6}>
              <Input
                placeholder="variable_name"
                value={row.name}
                onChange={(e) => updateRow(idx, { name: e.target.value })}
                style={{ width: 220, fontFamily: "monospace" }}
              />
              <Input
                placeholder="default value (empty = null)"
                value={row.value}
                onChange={(e) => updateRow(idx, { value: e.target.value })}
                style={{ flex: 1 }}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<MinusCircleOutlined />}
                onClick={() => removeRow(idx)}
              />
            </Space>
          ))}
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={addRow}
            style={{ marginTop: 4 }}
          >
            Add Field
          </Button>
        </Space>
      )}
    </Modal>
  );
}

export default function RolesPage() {
  const [fieldsRole, setFieldsRole] = useState<Role | null>(null);
  const { data: rolesData } = useQuery({
    queryKey: ["/roles", "field-editor-nav"],
    queryFn: () => listRecords<Role>("/roles", 0, 500),
  });
  const roles = rolesData?.items ?? [];
  const currentIndex = fieldsRole ? roles.findIndex((role) => role.id === fieldsRole.id) : -1;
  const previousRole = currentIndex > 0 ? roles[currentIndex - 1] : null;
  const nextRole = currentIndex >= 0 && currentIndex < roles.length - 1 ? roles[currentIndex + 1] : null;

  return (
    <>
      <CrudPage<Role>
        title="Roles"
        endpoint="/roles"
        columns={COLUMNS}
        formFields={FIELDS}
        extraActions={(record) => (
          <Button
            size="small"
            icon={<FieldStringOutlined />}
            onClick={() => setFieldsRole(record)}
          >
            Fields
          </Button>
        )}
      />
      {fieldsRole && (
        <RoleFieldsModal
          role={fieldsRole}
          onClose={() => setFieldsRole(null)}
          onPrevious={previousRole ? () => setFieldsRole(previousRole) : undefined}
          onNext={nextRole ? () => setFieldsRole(nextRole) : undefined}
        />
      )}
    </>
  );
}
