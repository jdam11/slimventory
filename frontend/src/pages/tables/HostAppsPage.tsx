import {
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import api from "../../api/client";
import { listRecords } from "../../api/crud";
import { buildHostQuickCreateConfig } from "./hostQuickCreate";
import { useAuth } from "../../store/AuthContext";
import { buildHostOption, buildSortedOptions, buildVlanOption, filterSelectOption } from "../../utils/selectOptions";
import type {
  App,
  AppField,
  Domain,
  Environment,
  HostApp,
  HostAppField,
  Host,
  HostType,
  K3sCluster,
  Role,
  Vlan,
} from "../../types";

const { Title } = Typography;

/** One grouped row shown in the table — one per app */
interface AppRow {
  app_id: number;
  host_ids: number[];
}

export default function HostAppsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [quickForm] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTarget, setQuickTarget] = useState<"host" | "app" | null>(null);
  const [valuesTarget, setValuesTarget] = useState<HostApp | null>(null);

  const { data: haData, isFetching, refetch } = useQuery({
    queryKey: ["/host-apps"],
    queryFn: () => api.get<HostApp[]>("/host-apps").then((r) => r.data),
  });

  const { data: hostData } = useQuery({ queryKey: ["/hosts"], queryFn: () => listRecords<Host>("/hosts", 0, 500) });
  const { data: appData } = useQuery({ queryKey: ["/apps"], queryFn: () => listRecords<App>("/apps", 0, 500) });
  const { data: envData } = useQuery({ queryKey: ["/environments"], queryFn: () => listRecords<Environment>("/environments", 0, 500) });
  const { data: hostTypeData } = useQuery({ queryKey: ["/host-types"], queryFn: () => listRecords<HostType>("/host-types", 0, 500) });
  const { data: vlanData } = useQuery({ queryKey: ["/vlans"], queryFn: () => listRecords<Vlan>("/vlans", 0, 500) });
  const { data: roleData } = useQuery({ queryKey: ["/roles"], queryFn: () => listRecords<Role>("/roles", 0, 500) });
  const { data: clusterData } = useQuery({ queryKey: ["/k3s-clusters"], queryFn: () => listRecords<K3sCluster>("/k3s-clusters", 0, 500) });
  const { data: domainData } = useQuery({ queryKey: ["/domains"], queryFn: () => listRecords<Domain>("/domains", 0, 500) });

  const hostOpts = buildSortedOptions(hostData?.items ?? [], buildHostOption);
  const appOpts = buildSortedOptions(appData?.items ?? [], (a) => ({ value: a.id, label: a.name }));
  const envOpts = buildSortedOptions(envData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const hostTypeOpts = buildSortedOptions(hostTypeData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const vlanOpts = buildSortedOptions(vlanData?.items ?? [], buildVlanOption);
  const roleOpts = buildSortedOptions(roleData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const clusterOpts = buildSortedOptions(clusterData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const domainOpts = buildSortedOptions(domainData?.items ?? [], (e) => ({ value: e.id, label: e.fqdn }));
  const hostQuick = buildHostQuickCreateConfig({
    envOpts,
    hostTypeOpts,
    vlanOpts,
    roleOpts,
    clusterOpts,
    hostOpts,
    domainOpts,
  });

  const hostName = (v: number) => hostOpts.find((o) => o.value === v)?.label ?? String(v);
  const appName = (v: number) => appOpts.find((o) => o.value === v)?.label ?? String(v);

  /** Derive one row per app, aggregating host_ids */
  const appRows: AppRow[] = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const ha of haData ?? []) {
      if (!map.has(ha.app_id)) map.set(ha.app_id, []);
      map.get(ha.app_id)!.push(ha.host_id);
    }
    return Array.from(map.entries())
      .map(([app_id, host_ids]) => ({ app_id, host_ids }))
      .sort((a, b) => appName(a.app_id).localeCompare(appName(b.app_id), undefined, { sensitivity: "base", numeric: true }));
  }, [appName, haData]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/host-apps"] });

  const bulkCreateMut = useMutation({
    mutationFn: (vals: { app_id: number; host_ids: number[] }) =>
      api.post("/host-apps/bulk", vals),
    onSuccess: () => { invalidate(); setModalOpen(false); form.resetFields(); message.success("Hosts added to app"); },
    onError: (e: unknown) =>
      message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Error"),
  });

  const deleteMut = useMutation({
    mutationFn: ({ host_id, app_id }: { host_id: number; app_id: number }) =>
      api.delete("/host-apps", { params: { host_id, app_id } }),
    onSuccess: () => { invalidate(); message.success("Association removed"); },
    onError: () => message.error("Failed to remove association"),
  });

  const quickCreateMut = useMutation({
    mutationFn: (vals: Record<string, unknown>) => {
      if (quickTarget === "host") {
        return api.post("/hosts", vals);
      }
      return api.post("/apps", vals);
    },
    onSuccess: (resp) => {
      if (quickTarget === "host") {
        qc.invalidateQueries({ queryKey: ["/hosts"] });
        const cur: number[] = form.getFieldValue("host_ids") ?? [];
        form.setFieldValue("host_ids", [...cur, (resp.data as { id: number }).id]);
      } else {
        qc.invalidateQueries({ queryKey: ["/apps"] });
        form.setFieldValue("app_id", (resp.data as { id: number }).id);
      }
      quickForm.resetFields();
      setQuickOpen(false);
      setQuickTarget(null);
      message.success("Created and selected");
    },
    onError: (e: unknown) =>
      message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Error"),
  });

  const renderQuickField = (field: { key: string; label: string; type: string; options?: { value: number | string; label: string }[]; min?: number }) => {
    if (field.type === "text") {
      return <Input />;
    }
    if (field.type === "number") {
      return <InputNumber min={field.min ?? 0} style={{ width: "100%" }} />;
    }
    if (field.type === "textarea") {
      return <Input.TextArea rows={3} />;
    }
    return (
      <Select
        options={field.options}
        showSearch
        filterOption={filterSelectOption}
      />
    );
  };

  const COLUMNS = [
    {
      title: "App",
      dataIndex: "app_id",
      key: "app",
      width: 180,
      render: (v: number) => <Tag color="blue">{appName(v)}</Tag>,
    },
    {
      title: "Hosts",
      dataIndex: "host_ids",
      key: "hosts",
      render: (host_ids: number[], row: AppRow) => (
        <Space size={[4, 4]} wrap>
          {host_ids.map((hid) => (
            <Tag
              key={hid}
              style={{ cursor: "pointer", userSelect: "none" }}
              closable={isAdmin}
              onClose={(e) => {
                e.preventDefault();
                deleteMut.mutate({ host_id: hid, app_id: row.app_id });
              }}
              onClick={() => setValuesTarget({ host_id: hid, app_id: row.app_id })}
            >
              {hostName(hid)}
            </Tag>
          ))}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Host Apps</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
          {isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              Add
            </Button>
          )}
        </Space>
      </div>

      <Table<AppRow>
        dataSource={appRows}
        rowKey="app_id"
        columns={COLUMNS}
        loading={isFetching}
        size="small"
        pagination={false}
      />

      {/* Bulk add modal: one app + multiple hosts */}
      <Modal
        title="Add Hosts → App"
        open={modalOpen}
        onOk={() =>
          form.validateFields().then((v) =>
            bulkCreateMut.mutate({ app_id: v.app_id, host_ids: v.host_ids })
          )
        }
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        confirmLoading={bulkCreateMut.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="app_id" label="App" rules={[{ required: true }]}>
            <Select
              options={appOpts}
              showSearch
              filterOption={filterSelectOption}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  {isAdmin && (
                    <>
                      <Divider style={{ margin: "8px 0" }} />
                      <Button
                        type="link"
                        block
                        onClick={() => {
                          setQuickTarget("app");
                          quickForm.resetFields();
                          setQuickOpen(true);
                        }}
                        style={{ textAlign: "left" }}
                      >
                        Create new App
                      </Button>
                    </>
                  )}
                </>
              )}
            />
          </Form.Item>
          <Form.Item name="host_ids" label="Hosts" rules={[{ required: true, type: "array", min: 1, message: "Select at least one host" }]}>
            <Select
              mode="multiple"
              options={hostOpts}
              showSearch
              filterOption={filterSelectOption}
              placeholder="Select one or more hosts"
              dropdownRender={(menu) => (
                <>
                  {menu}
                  {isAdmin && (
                    <>
                      <Divider style={{ margin: "8px 0" }} />
                      <Button
                        type="link"
                        block
                        onClick={() => {
                          setQuickTarget("host");
                          quickForm.resetFields();
                          setQuickOpen(true);
                        }}
                        style={{ textAlign: "left" }}
                      >
                        Create new Host
                      </Button>
                    </>
                  )}
                </>
              )}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={quickTarget === "host" ? "Create Host" : "Create App"}
        open={quickOpen}
        onCancel={() => {
          setQuickOpen(false);
          setQuickTarget(null);
          quickForm.resetFields();
        }}
        onOk={() => quickForm.validateFields().then((v) => quickCreateMut.mutate(v))}
        confirmLoading={quickCreateMut.isPending}
        destroyOnClose
      >
        <Form form={quickForm} layout="vertical" style={{ marginTop: 16 }}>
          {(quickTarget === "host"
            ? hostQuick.fields
            : [
                { key: "name", label: "Name", type: "text", required: true },
                { key: "description", label: "Description", type: "text" },
              ]
          ).map((f) => (
            <Form.Item key={f.key} name={f.key} label={f.label} rules={f.required ? [{ required: true }] : []}>
              {renderQuickField(f)}
            </Form.Item>
          ))}
        </Form>
      </Modal>

      {valuesTarget && (
        <FieldValuesModal
          hostApp={valuesTarget}
          hostLabel={hostName(valuesTarget.host_id)}
          appLabel={appName(valuesTarget.app_id)}
          isAdmin={isAdmin}
          onClose={() => setValuesTarget(null)}
        />
      )}
    </div>
  );
}

interface FieldValuesModalProps {
  hostApp: HostApp;
  hostLabel: string;
  appLabel: string;
  isAdmin: boolean;
  onClose: () => void;
}

function FieldValuesModal({
  hostApp,
  hostLabel,
  appLabel,
  isAdmin,
  onClose,
}: FieldValuesModalProps) {
  const [form] = Form.useForm();
  const qc = useQueryClient();

  const fieldsKey = [`/app-fields?app_id=${hostApp.app_id}`];
  const valuesKey = [
    `/host-app-fields?host_id=${hostApp.host_id}&app_id=${hostApp.app_id}`,
  ];

  const { data: appFields = [], isFetching: fetchingFields } = useQuery({
    queryKey: fieldsKey,
    queryFn: () =>
      api
        .get<AppField[]>("/app-fields", { params: { app_id: hostApp.app_id } })
        .then((r) => r.data),
  });

  const { data: existingValues = [], isFetching: fetchingValues } = useQuery({
    queryKey: valuesKey,
    queryFn: () =>
      api
        .get<HostAppField[]>("/host-app-fields", {
          params: { host_id: hostApp.host_id, app_id: hostApp.app_id },
        })
        .then((r) => r.data),
  });

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const v of existingValues) {
      initial[`field_${v.field_id}`] = v.value ?? "";
    }
    form.setFieldsValue(initial);
  }, [existingValues, form]);

  // Also pre-fill form when data arrives (handles cache hit where onSuccess skips)
  const initialValues: Record<string, string> = {};
  for (const v of existingValues) {
    initialValues[`field_${v.field_id}`] = v.value ?? "";
  }

  const saveMut = useMutation({
    mutationFn: (vals: Record<string, string>) => {
      const entries = appFields.map((f) => ({
        field_id: f.id,
        value: vals[`field_${f.id}`] ?? null,
      }));
      return api.put("/host-app-fields", {
        host_id: hostApp.host_id,
        app_id: hostApp.app_id,
        values: entries,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: valuesKey });
      message.success("Values saved");
      onClose();
    },
    onError: (e: unknown) =>
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? "Error saving values"
      ),
  });

  const loading = fetchingFields || fetchingValues;

  return (
    <Modal
      title={
        <span>
          Field values — <Tag>{hostLabel}</Tag> →{" "}
          <Tag color="blue">{appLabel}</Tag>
        </span>
      }
      open
      onCancel={onClose}
      onOk={() =>
        form
          .validateFields()
          .then((vals) => saveMut.mutate(vals as Record<string, string>))
      }
      confirmLoading={saveMut.isPending}
      okButtonProps={{ disabled: !isAdmin }}
      destroyOnClose
      width={480}
    >
      {appFields.length === 0 && !loading ? (
        <Typography.Text type="secondary">
          This app has no fields defined. Add fields on the Apps page first.
        </Typography.Text>
      ) : (
        <Form
          form={form}
          layout="vertical"
          initialValues={initialValues}
          style={{ marginTop: 8 }}
        >
          {appFields.map((f) => (
            <Form.Item
              key={f.id}
              name={`field_${f.id}`}
              label={
                <span>
                  <Typography.Text code>{f.name}</Typography.Text>
                </span>
              }
            >
              <Input disabled={!isAdmin} placeholder={`Value for ${f.name}`} />
            </Form.Item>
          ))}
        </Form>
      )}
    </Modal>
  );
}
