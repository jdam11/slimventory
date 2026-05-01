/**
 * AppImportModal — Preview and confirm importing an App from a git repo.
 *
 * 1. Calls POST /git-repos/{id}/preview-import to parse docker-compose.yml + .env.example
 * 2. Shows an editable table of detected fields (name, default, is_secret)
 * 3. On confirm, creates the App record then all AppField records
 */
import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Typography,
  message,
} from "antd";
import { useMutation } from "@tanstack/react-query";
import { previewImportApp } from "../api/git";
import { createRecord } from "../api/crud";
import type { AppImportField, AppImportPreview, GitRepo } from "../types";

const { Text } = Typography;

interface EditableField extends AppImportField {
  _key: string;
  is_secret: boolean;
}

interface Props {
  repo: GitRepo;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function AppImportModal({ repo, open, onClose, onImported }: Props) {
  const [step, setStep] = useState<"preview" | "confirm">("preview");
  const [, setPreview] = useState<AppImportPreview | null>(null);
  const [appName, setAppName] = useState("");
  const [fields, setFields] = useState<EditableField[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const previewMutation = useMutation({
    mutationFn: () => previewImportApp(repo.id),
    onSuccess: (data) => {
      setPreview(data);
      setAppName(data.suggested_name);
      setFields(
        data.fields.map((f, i) => ({
          ...f,
          _key: `${i}`,
          is_secret: f.is_secret_hint,
        }))
      );
      setStep("confirm");
      setPreviewError(null);
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPreviewError(msg ?? "Failed to parse repository.");
    },
  });

  async function handleImport() {
    if (!appName.trim()) {
      message.error("App name is required.");
      return;
    }
    setImporting(true);
    try {
      // 1. Create the App
      const app = await createRecord<{ id: number }>("/apps", {
        name: appName.trim(),
        description: `Imported from ${repo.name}`,
      });

      // 2. Create each AppField
      for (const f of fields) {
        if (!f.name.trim()) continue;
        await createRecord("/app-fields", {
          app_id: app.id,
          name: f.name.trim(),
          default_value: f.default_value ?? null,
          is_secret: f.is_secret,
        });
      }

      message.success(`App "${appName}" imported with ${fields.length} field(s).`);
      onImported();
      onClose();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail ?? "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  function updateField(key: string, patch: Partial<EditableField>) {
    setFields((prev) => prev.map((f) => (f._key === key ? { ...f, ...patch } : f)));
  }

  function removeField(key: string) {
    setFields((prev) => prev.filter((f) => f._key !== key));
  }

  const columns = [
    {
      title: "Field Name",
      dataIndex: "name",
      render: (val: string, rec: EditableField) => (
        <Input
          size="small"
          value={val}
          onChange={(e) => updateField(rec._key, { name: e.target.value })}
        />
      ),
    },
    {
      title: "Default Value",
      dataIndex: "default_value",
      render: (val: string | null, rec: EditableField) => (
        <Input
          size="small"
          value={val ?? ""}
          placeholder="(none)"
          onChange={(e) => updateField(rec._key, { default_value: e.target.value || null })}
        />
      ),
    },
    {
      title: "Secret",
      dataIndex: "is_secret",
      width: 70,
      render: (val: boolean, rec: EditableField) => (
        <Checkbox checked={val} onChange={(e) => updateField(rec._key, { is_secret: e.target.checked })} />
      ),
    },
    {
      title: "",
      key: "remove",
      width: 60,
      render: (_: unknown, rec: EditableField) => (
        <Button size="small" danger onClick={() => removeField(rec._key)}>
          ✕
        </Button>
      ),
    },
  ];

  return (
    <Modal
      title={`Import App from "${repo.name}"`}
      open={open}
      onCancel={onClose}
      width={700}
      footer={
        step === "confirm"
          ? [
              <Button key="cancel" onClick={onClose}>
                Cancel
              </Button>,
              <Button key="import" type="primary" loading={importing} onClick={handleImport}>
                Import App
              </Button>,
            ]
          : null
      }
    >
      {step === "preview" && (
        <div style={{ textAlign: "center", padding: 40 }}>
          {previewMutation.isPending ? (
            <Space direction="vertical" align="center">
              <Spin />
              <Text>Parsing repository…</Text>
            </Space>
          ) : previewError ? (
            <Alert type="error" message={previewError} showIcon />
          ) : null}
        </div>
      )}

      {step === "confirm" && (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Form layout="inline">
            <Form.Item label="App Name" required>
              <Input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                style={{ width: 280 }}
              />
            </Form.Item>
          </Form>

          <Text type="secondary">
            {fields.length} field(s) detected. Review and adjust before importing.
          </Text>

          <Table
            size="small"
            dataSource={fields}
            columns={columns}
            rowKey="_key"
            pagination={false}
            scroll={{ y: 320 }}
          />
        </Space>
      )}
    </Modal>
  );
}
