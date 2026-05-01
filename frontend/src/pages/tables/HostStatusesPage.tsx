import {
  FieldStringOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Modal,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import * as jsyaml from "js-yaml";
import api from "../../api/client";
import { listRecords } from "../../api/crud";
import CrudPage from "../../components/CrudPage";
import type { HostStatus, StatusField } from "../../types";

const { Text } = Typography;

const COLUMNS = [
  { title: "Name", dataIndex: "name", key: "name" },
];

const FIELDS = [
  { key: "name", label: "Name", type: "text" as const, required: true },
];

function fieldsToYaml(fields: StatusField[]): string {
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

function StatusFieldsModal({
  status,
  onClose,
  onPrevious,
  onNext,
}: {
  status: HostStatus;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const qc = useQueryClient();
  const queryKey = [`/status-fields?status_id=${status.id}`];
  const [yamlText, setYamlText] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setYamlText(null);
    setParseError(null);
  }, [status.id]);

  const { data: fields = [], isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      api
        .get<StatusField[]>("/status-fields", { params: { status_id: status.id } })
        .then((r) => r.data),
    select: (data) => {
      if (yamlText === null) {
        setYamlText(fieldsToYaml(data));
      }
      return data;
    },
  });

  const saveMut = useMutation({
    mutationFn: (fieldsMap: Record<string, string | null>) =>
      api.put(`/status-fields/yaml/${status.id}`, { fields: fieldsMap }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["/status-fields"] });
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
        parseYaml(text);
        setYamlText(text);
      } catch (err) {
        setParseError((err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const editorValue = yamlText ?? (isFetching ? "" : fieldsToYaml(fields));

  return (
    <Modal
      title={
        <span>
          Fields (YAML defaults) for status <Tag color="orange">{status.name}</Tag>
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
            Each key is an Ansible variable name; the value is its default for all hosts
            with this status. Host-level overrides take precedence.
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

export default function HostStatusesPage() {
  const [fieldsStatus, setFieldsStatus] = useState<HostStatus | null>(null);
  const { data: statusesData } = useQuery({
    queryKey: ["/host-statuses", "field-editor-nav"],
    queryFn: () => listRecords<HostStatus>("/host-statuses", 0, 500),
  });
  const statuses = statusesData?.items ?? [];
  const currentIndex = fieldsStatus ? statuses.findIndex((status) => status.id === fieldsStatus.id) : -1;
  const previousStatus = currentIndex > 0 ? statuses[currentIndex - 1] : null;
  const nextStatus = currentIndex >= 0 && currentIndex < statuses.length - 1 ? statuses[currentIndex + 1] : null;

  return (
    <>
      <CrudPage<HostStatus>
        title="Host Statuses"
        endpoint="/host-statuses"
        columns={COLUMNS}
        formFields={FIELDS}
        extraActions={(record) => (
          <Button
            size="small"
            icon={<FieldStringOutlined />}
            onClick={() => setFieldsStatus(record)}
          >
            Fields
          </Button>
        )}
      />
      {fieldsStatus && (
        <StatusFieldsModal
          status={fieldsStatus}
          onClose={() => setFieldsStatus(null)}
          onPrevious={previousStatus ? () => setFieldsStatus(previousStatus) : undefined}
          onNext={nextStatus ? () => setFieldsStatus(nextStatus) : undefined}
        />
      )}
    </>
  );
}
