import {
  FieldStringOutlined,
  PartitionOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Modal,
  Space,
  Spin,
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
import SortableRoleSelect from "../../components/SortableRoleSelect";
import type { HostType, HostTypeField, HostTypeRole, Role } from "../../types";

const { Text } = Typography;


function fieldsToYaml(fields: HostTypeField[]): string {
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


function HostTypeFieldsModal({
  hostType,
  onClose,
  onPrevious,
  onNext,
}: {
  hostType: HostType;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const qc = useQueryClient();
  const queryKey = [`/host-type-fields?host_type_id=${hostType.id}`];
  const [yamlText, setYamlText] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setYamlText(null);
    setParseError(null);
  }, [hostType.id]);

  const { data: fields = [], isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      api
        .get<HostTypeField[]>("/host-type-fields", {
          params: { host_type_id: hostType.id },
        })
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
      api
        .put(`/host-type-fields/yaml/${hostType.id}`, { fields: fieldsMap })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["/host-type-fields"] });
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
          Fields (YAML defaults) for host type{" "}
          <Tag color="geekblue">{hostType.name}</Tag>
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
            Each key is an Ansible variable name; the value is its default for
            all hosts with this host type. Host-level overrides take precedence.
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
        {parseError && <Alert type="error" message={parseError} showIcon />}
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


function HostTypeRolesModal({
  hostType,
  onClose,
}: {
  hostType: HostType;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const rolesQueryKey = ["/roles"];
  const assignmentsQueryKey = [`/host-type-roles?host_type_id=${hostType.id}`];

  const [roleIds, setRoleIds] = useState<number[] | null>(null);

  const { data: rolesData } = useQuery({
    queryKey: rolesQueryKey,
    queryFn: () => listRecords<Role>("/roles", 0, 500),
  });
  const roleOpts = (rolesData?.items ?? []).map((r) => ({
    value: r.id,
    label: r.name,
  }));

  const { isFetching } = useQuery({
    queryKey: assignmentsQueryKey,
    queryFn: () =>
      api
        .get<HostTypeRole[]>("/host-type-roles/", {
          params: { host_type_id: hostType.id },
        })
        .then((r) => r.data),
    select: (data) => {
      if (roleIds === null) {
        const sorted = [...data].sort((a, b) => a.priority - b.priority);
        setRoleIds(sorted.map((d) => d.role_id));
      }
      return data;
    },
  });

  const saveMut = useMutation({
    mutationFn: (ids: number[]) =>
      api
        .put("/host-type-roles/", {
          host_type_id: hostType.id,
          roles: ids.map((role_id, i) => ({ role_id, priority: i + 1 })),
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: assignmentsQueryKey });
      message.success("Host type roles saved");
    },
    onError: (e: unknown) =>
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? "Save failed"
      ),
  });

  function handleSave() {
    saveMut.mutate(roleIds ?? []);
  }

  return (
    <Modal
      title={
        <span>
          Roles for host type <Tag color="geekblue">{hostType.name}</Tag>
        </span>
      }
      open
      width={520}
      onCancel={onClose}
      destroyOnClose
      footer={
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
      }
    >
      {isFetching && roleIds === null ? (
        <Spin />
      ) : (
        <>
          <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 12 }}>
            Drag to reorder priority. First role = highest precedence in the
            Ansible inventory.
          </Text>
          <SortableRoleSelect
            value={roleIds ?? []}
            onChange={setRoleIds}
            options={roleOpts}
          />
        </>
      )}
    </Modal>
  );
}


export default function HostTypesPage() {
  const [fieldsHostType, setFieldsHostType] = useState<HostType | null>(null);
  const [rolesHostType, setRolesHostType] = useState<HostType | null>(null);
  const { data: hostTypesData } = useQuery({
    queryKey: ["/host-types", "field-editor-nav"],
    queryFn: () => listRecords<HostType>("/host-types", 0, 500),
  });
  const hostTypes = hostTypesData?.items ?? [];
  const currentIndex = fieldsHostType ? hostTypes.findIndex((hostType) => hostType.id === fieldsHostType.id) : -1;
  const previousHostType = currentIndex > 0 ? hostTypes[currentIndex - 1] : null;
  const nextHostType = currentIndex >= 0 && currentIndex < hostTypes.length - 1 ? hostTypes[currentIndex + 1] : null;

  const COLUMNS = [
    { title: "Name", dataIndex: "name", key: "name" },
  ];

  const FIELDS = [
    { key: "name", label: "Name", type: "text" as const, required: true },
  ];

  return (
    <>
      <CrudPage<HostType>
        title="Host Types"
        endpoint="/host-types"
        columns={COLUMNS}
        formFields={FIELDS}
        extraActions={(record) => (
          <Space>
            <Button
              size="small"
              icon={<FieldStringOutlined />}
              onClick={() => setFieldsHostType(record)}
            >
              Fields
            </Button>
            <Button
              size="small"
              icon={<PartitionOutlined />}
              onClick={() => setRolesHostType(record)}
            >
              Roles
            </Button>
          </Space>
        )}
      />
      {fieldsHostType && (
        <HostTypeFieldsModal
          hostType={fieldsHostType}
          onClose={() => setFieldsHostType(null)}
          onPrevious={previousHostType ? () => setFieldsHostType(previousHostType) : undefined}
          onNext={nextHostType ? () => setFieldsHostType(nextHostType) : undefined}
        />
      )}
      {rolesHostType && (
        <HostTypeRolesModal
          hostType={rolesHostType}
          onClose={() => setRolesHostType(null)}
        />
      )}
    </>
  );
}
