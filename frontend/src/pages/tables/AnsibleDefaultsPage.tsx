import { UploadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Space,
  Typography,
  message,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import * as jsyaml from "js-yaml";
import api from "../../api/client";
import type { AnsibleDefault } from "../../types";

const { Title, Text, Paragraph } = Typography;

function fieldsToYaml(defaults: AnsibleDefault[]): string {
  if (defaults.length === 0) return "---\n";
  const obj: Record<string, string | null> = {};
  for (const d of defaults) {
    obj[d.name] = d.value ?? null;
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

export default function AnsibleDefaultsPage() {
  const qc = useQueryClient();
  const queryKey = ["/ansible-defaults"];
  const [yamlText, setYamlText] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: defaults = [], isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      api.get<AnsibleDefault[]>("/ansible-defaults").then((r) => r.data),
    select: (data) => {
      if (yamlText === null) {
        setYamlText(fieldsToYaml(data));
      }
      return data;
    },
  });

  const saveMut = useMutation({
    mutationFn: (fieldsMap: Record<string, string | null>) =>
      api.put("/ansible-defaults/yaml", { fields: fieldsMap }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      message.success("Ansible defaults saved");
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

  const editorValue = yamlText ?? (isFetching ? "" : fieldsToYaml(defaults));

  return (
    <div>
      <Title level={4} style={{ marginBottom: 4 }}>Ansible Inventory Defaults</Title>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        Global Ansible variables applied to every host in the inventory. Define variables
        like <Text code>ansible_user</Text>, <Text code>ansible_port</Text>, or
        <Text code>ansible_python_interpreter</Text> here. Per-host overrides (set in the
        host detail panel) take precedence over these defaults.
      </Paragraph>

      <Alert
        type="info"
        showIcon
        style={{ maxWidth: 800, marginBottom: 16 }}
        message="Windows Kerberos runs"
        description={
          <>
            Runner-side Kerberos support is configured in Admin under <Text code>Ansible Runner Settings</Text>.
            Inventory-side connection vars still belong here or in your host type / role / status fields, for example
            <Text code style={{ marginLeft: 6 }}>ansible_connection=winrm</Text>,
            <Text code style={{ marginLeft: 6 }}>ansible_winrm_transport=kerberos</Text>,
            <Text code style={{ marginLeft: 6 }}>ansible_shell_type=powershell</Text>.
          </>
        }
      />

      <Card style={{ maxWidth: 800 }}>
        <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }}>
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Keys are Ansible variable names; values are their global defaults.
              Variables not listed here are deleted on save.
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
            minHeight: 380,
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
            display: "block",
          }}
        />
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <Button
            type="primary"
            loading={saveMut.isPending || isFetching}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </Card>
    </div>
  );
}
