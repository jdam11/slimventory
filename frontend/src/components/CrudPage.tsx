/**
 * Generic CRUD page component.
 *
 * Handles: paginated table, create modal (admin), edit modal (admin),
 * delete confirmation (admin), server-state via TanStack Query.
 *
 * Props:
 *   title       – page heading
 *   endpoint    – API path, e.g. "/environments"
 *   columns     – Ant Design table column definitions (without action column)
 *   formFields  – field definitions used to build the create/edit form
 *   rowKey      – primary key field name (default "id")
 */
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Button,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Typography,
  message,
} from "antd";
import type { TableColumnType } from "antd";
import type { Key } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { createRecord, deleteRecord, listRecords, updateRecord } from "../api/crud";
import { useAuth } from "../store/AuthContext";

const { Title } = Typography;

export type FieldType = "text" | "number" | "textarea" | "select" | "password" | "multiselect";

export interface SelectOption {
  value: number | string;
  label: string;
  searchText?: string;
}

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  section?: string;
  helperText?: string;
  span?: 1 | 2;
  options?: SelectOption[];
  min?: number;
  placeholder?: string;
  quickCreate?: {
    endpoint: string;
    queryKey: string;
    fields: FormField[];
    title?: string;
    actionLabel?: string;
    valueField?: string;
    initialValues?: (parentValues: Record<string, unknown>) => Record<string, unknown>;
  };
}

interface CrudPageProps<T extends object> {
  title: string;
  endpoint: string;
  columns: TableColumnType<T>[];
  formFields: FormField[];
  rowKey?: string;
  extraActions?: (record: T) => ReactNode;
  openEditOnDoubleClick?: boolean;
  /** Called when the create/edit modal opens. editing=null means create mode. */
  onModalOpen?: (editing: T | null) => void;
  /** Extra content rendered inside the modal form, below all standard fields. */
  extraModalContent?: ReactNode;
  /** Return an error string to block submission; return null to allow. */
  onBeforeSubmit?: () => string | null;
  /** Called after a record is successfully created (receives the new record). */
  onAfterCreate?: (record: T) => void;
  /** Called after a record is successfully updated (receives the updated record). */
  onAfterUpdate?: (record: T) => void;
  /** Extra buttons rendered in the header row alongside Add/Reload. */
  extraHeaderButtons?: ReactNode;
  /** Optional transform to prefill the create modal from an existing record. */
  cloneRecord?: (record: T) => Record<string, unknown>;
  /** Optional tooltip label for the clone action button. */
  cloneActionLabel?: string;
  /** Called when table selection changes. */
  onSelectionChange?: (keys: Key[], rows: T[]) => void;
  /** Keep selected rows after bulk edit succeeds. */
  preserveSelectionOnBulkEdit?: boolean;
}

export default function CrudPage<T extends object>({
  title,
  endpoint,
  columns,
  formFields,
  rowKey = "id",
  extraActions,
  openEditOnDoubleClick = true,
  onModalOpen,
  extraModalContent,
  onBeforeSubmit,
  onAfterCreate,
  onAfterUpdate,
  extraHeaderButtons,
  cloneRecord,
  cloneActionLabel = "Clone",
  onSelectionChange,
  preserveSelectionOnBulkEdit = false,
}: CrudPageProps<T>) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [bulkForm] = Form.useForm();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditLoading, setBulkEditLoading] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [quickCreateField, setQuickCreateField] = useState<FormField | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateLoading, setQuickCreateLoading] = useState(false);
  const [quickCreateForm] = Form.useForm();
  const [search, setSearch] = useState("");

  const skip = (page - 1) * pageSize;
  // When a search is active fetch all records so filtering isn't page-scoped
  const effectiveSkip = search ? 0 : skip;
  const effectiveLimit = search ? 1000 : pageSize;

  const { data, isFetching, refetch } = useQuery({
    queryKey: [endpoint, search ? "search" : page, search ? "all" : pageSize, search],
    queryFn: () => listRecords<T>(endpoint, effectiveSkip, effectiveLimit),
  });

  const displayItems = useMemo(() => {
    if (!search || !data?.items) return data?.items;
    const lower = search.toLowerCase();
    return data.items.filter((item) =>
      Object.values(item as Record<string, unknown>).some((val) =>
        String(val ?? "").toLowerCase().includes(lower)
      )
    );
  }, [data?.items, search]);

  const invalidate = () => qc.invalidateQueries({ queryKey: [endpoint] });
  const modalWidth = extraModalContent ? 920 : 820;

  const createMut = useMutation({
    mutationFn: (vals: unknown) => createRecord<T>(endpoint, vals),
    onSuccess: (record) => { invalidate(); closeModal(); message.success("Created"); onAfterCreate?.(record); },
    onError: (e: unknown) => message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Error"),
  });

  const updateMut = useMutation({
    mutationFn: (vals: unknown) =>
      updateRecord<T>(endpoint, (editing as Record<string, unknown>)[rowKey] as number, vals),
    onSuccess: (record) => { invalidate(); closeModal(); message.success("Updated"); onAfterUpdate?.(record); },
    onError: (e: unknown) => message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Error"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number | string) => deleteRecord(endpoint, id),
    onSuccess: () => { invalidate(); message.success("Deleted"); },
    onError: (e: unknown) => message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Cannot delete — record may be in use"),
  });

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
    onModalOpen?.(null);
  }

  function openClone(record: T) {
    if (!cloneRecord || !isAdmin) {
      return;
    }
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(cloneRecord(record));
    setModalOpen(true);
    onModalOpen?.(null);
  }

  function openEdit(record: T) {
    setEditing(record);
    form.setFieldsValue(record);
    setModalOpen(true);
    onModalOpen?.(record);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  }

  function openQuickCreate(field: FormField) {
    if (!field.quickCreate || !isAdmin) {
      return;
    }
    setQuickCreateField(field);
    quickCreateForm.resetFields();
    const parentValues = form.getFieldsValue() as Record<string, unknown>;
    const defaults = field.quickCreate.initialValues?.(parentValues) ?? {};
    quickCreateForm.setFieldsValue(defaults);
    setQuickCreateOpen(true);
  }

  function closeQuickCreate() {
    setQuickCreateOpen(false);
    setQuickCreateField(null);
    quickCreateForm.resetFields();
  }

  async function submitQuickCreate() {
    if (!quickCreateField?.quickCreate) {
      return;
    }
    try {
      const vals = await quickCreateForm.validateFields();
      const clean = Object.fromEntries(
        Object.entries(vals).filter(([, v]) => v !== undefined && v !== "")
      );
      setQuickCreateLoading(true);
      const created = await createRecord<Record<string, unknown>>(
        quickCreateField.quickCreate.endpoint,
        clean
      );
      await qc.invalidateQueries({
        queryKey: [quickCreateField.quickCreate.queryKey],
      });
      const valueField = quickCreateField.quickCreate.valueField ?? "id";
      const createdId = created[valueField] as number | string | undefined;
      if (createdId !== undefined) {
        form.setFieldValue(quickCreateField.key, createdId);
      }
      message.success("Created and selected");
      closeQuickCreate();
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown }).errorFields) {
        return;
      }
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to create"
      );
    } finally {
      setQuickCreateLoading(false);
    }
  }

  function renderFieldInput(field: FormField, inQuickCreate = false) {
    if (field.type === "text") {
      return <Input placeholder={field.placeholder} />;
    }
    if (field.type === "password") {
      return <Input.Password />;
    }
    if (field.type === "number") {
      return <InputNumber min={field.min ?? 0} style={{ width: "100%" }} />;
    }
    if (field.type === "textarea") {
      return <Input.TextArea rows={3} />;
    }
    if (field.type === "select") {
      const canQuickCreate = !inQuickCreate && isAdmin && !!field.quickCreate;
      return (
        <Select
          options={field.options}
          showSearch
          filterOption={(input, opt) =>
            `${String(opt?.label ?? "")} ${String((opt as SelectOption | undefined)?.searchText ?? "")}`
              .toLowerCase()
              .includes(input.toLowerCase())
          }
          dropdownRender={(menu) => (
            <>
              {menu}
              {canQuickCreate && (
                <>
                  <Divider style={{ margin: "8px 0" }} />
                  <Button
                    type="link"
                    block
                    onClick={() => openQuickCreate(field)}
                    style={{ textAlign: "left" }}
                  >
                    {field.quickCreate?.actionLabel ?? `Create new ${field.label}`}
                  </Button>
                </>
              )}
            </>
          )}
        />
      );
    }
    if (field.type === "multiselect") {
      return (
        <Select
          mode="multiple"
          options={field.options}
          showSearch
          filterOption={(input, opt) =>
            `${String(opt?.label ?? "")} ${String((opt as SelectOption | undefined)?.searchText ?? "")}`
              .toLowerCase()
              .includes(input.toLowerCase())
          }
          placeholder={field.placeholder ?? `Select ${field.label}`}
        />
      );
    }
    return null;
  }

  function renderFieldLabel(field: FormField) {
    if (!field.helperText) {
      return field.label;
    }
    return (
      <div className="crud-form-label">
        <span>{field.label}</span>
        <Typography.Text type="secondary" className="crud-form-helper">
          {field.helperText}
        </Typography.Text>
      </div>
    );
  }

  function getFieldSpan(field: FormField) {
    if (field.span) {
      return field.span;
    }
    if (field.type === "textarea" || field.type === "multiselect") {
      return 2;
    }
    return 1;
  }

  function renderFormFields(
    fields: FormField[],
    options?: { inQuickCreate?: boolean; includeExtraContent?: boolean; enforceRequired?: boolean }
  ) {
    const inQuickCreate = options?.inQuickCreate ?? false;
    const includeExtraContent = options?.includeExtraContent ?? false;
    const enforceRequired = options?.enforceRequired ?? true;
    const sections: { key: string; title?: string; fields: FormField[] }[] = [];
    for (const field of fields) {
      const sectionKey = field.section ?? "__default__";
      const current = sections[sections.length - 1];
      if (!current || current.key !== sectionKey) {
        sections.push({
          key: sectionKey,
          title: field.section,
          fields: [field],
        });
      } else {
        current.fields.push(field);
      }
    }

    return sections.map((section, index) => (
      <div
        key={section.key}
        className={`crud-form-section${section.title ? " crud-form-section-bordered" : ""}`}
      >
        {section.title && (
          <div className="crud-form-section-header">
            <Typography.Text strong>{section.title}</Typography.Text>
          </div>
        )}
        <Row gutter={[16, 0]}>
          {section.fields.map((field) => (
            <Col key={field.key} xs={24} md={getFieldSpan(field) === 2 ? 24 : 12}>
              <Form.Item
                name={field.key}
                label={renderFieldLabel(field)}
                rules={
                  enforceRequired && field.required
                    ? [{ required: true, message: `${field.label} is required` }]
                    : []
                }
              >
                {renderFieldInput(field, inQuickCreate)}
              </Form.Item>
            </Col>
          ))}
          {index === sections.length - 1 && includeExtraContent && extraModalContent && !inQuickCreate && (
            <Col span={24}>
              <div className="crud-form-extra">{extraModalContent}</div>
            </Col>
          )}
        </Row>
      </div>
    ));
  }

  function handleSubmit() {
    const extraError = onBeforeSubmit?.();
    if (extraError) {
      message.error(extraError);
      return;
    }
    form.validateFields().then((vals) => {
      // Strip undefined so PATCH only sends changed fields
      const clean = Object.fromEntries(
        Object.entries(vals).filter(([, v]) => v !== undefined && v !== "")
      );
      editing ? updateMut.mutate(clean) : createMut.mutate(clean);
    });
  }

  function openBulkEdit() {
    bulkForm.resetFields();
    setBulkEditOpen(true);
  }

  function closeBulkEdit() {
    setBulkEditOpen(false);
    bulkForm.resetFields();
  }

  async function handleBulkEdit() {
    const vals = bulkForm.getFieldsValue();
    const clean = Object.fromEntries(
      Object.entries(vals).filter(([, v]) => v !== undefined && v !== "" && v !== null)
    );
    if (Object.keys(clean).length === 0) {
      message.warning("Fill in at least one field to update");
      return;
    }
    setBulkEditLoading(true);
    try {
      for (const key of selectedRowKeys) {
        await updateRecord<T>(endpoint, key as number, clean);
      }
      invalidate();
      closeBulkEdit();
      if (!preserveSelectionOnBulkEdit) {
        setSelectedRowKeys([]);
        onSelectionChange?.([], []);
      }
      message.success(`Updated ${selectedRowKeys.length} record(s)`);
    } catch (e: unknown) {
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Some updates failed"
      );
    } finally {
      setBulkEditLoading(false);
    }
  }

  async function handleBulkDelete() {
    setBulkDeleteLoading(true);
    try {
      for (const key of selectedRowKeys) {
        await deleteRecord(endpoint, key as number);
      }
      invalidate();
      setSelectedRowKeys([]);
      onSelectionChange?.([], []);
      message.success(`Deleted ${selectedRowKeys.length} record(s)`);
    } catch (e: unknown) {
      message.error(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Cannot delete — some records may be in use"
      );
    } finally {
      setBulkDeleteLoading(false);
    }
  }

  const actionColumn: TableColumnType<T> = {
    title: "Actions",
    key: "actions",
    width: 110,
    render: (_: unknown, record: T) => (
      <Space>
        {extraActions?.(record)}
        {cloneRecord && (
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => openClone(record)}
            disabled={!isAdmin}
            title={cloneActionLabel}
          />
        )}
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={() => openEdit(record)}
          disabled={!isAdmin}
        />
        <Popconfirm
          title="Delete this record?"
          okText="Yes"
          cancelText="No"
          disabled={!isAdmin}
          onConfirm={() =>
            deleteMut.mutate((record as { [key: string]: unknown })[rowKey] as number)
              }
        >
          <Button size="small" danger icon={<DeleteOutlined />} disabled={!isAdmin} />
        </Popconfirm>
      </Space>
    ),
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <Title level={4} style={{ margin: 0 }}>
          {title}
        </Title>
        <Space wrap>
          <Input.Search
            placeholder="Filter…"
            allowClear
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            onSearch={(val) => { setSearch(val); setPage(1); }}
            style={{ width: 180 }}
          />
          {isAdmin && selectedRowKeys.length > 0 && (
            <>
              <Button onClick={openBulkEdit}>
                Bulk Edit ({selectedRowKeys.length})
              </Button>
              <Popconfirm
                title={`Delete ${selectedRowKeys.length} selected record(s)?`}
                okText="Yes"
                cancelText="No"
                onConfirm={handleBulkDelete}
              >
                <Button danger loading={bulkDeleteLoading}>
                  Bulk Delete ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            </>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
          {extraHeaderButtons}
          {isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add
            </Button>
          )}
        </Space>
      </div>

      <Table<T>
        dataSource={displayItems}
        rowKey={rowKey}
        columns={[...columns, actionColumn]}
        loading={isFetching}
        onRow={(record) =>
          openEditOnDoubleClick && isAdmin
            ? {
                onDoubleClick: () => openEdit(record),
                style: { cursor: "pointer" },
              }
            : {}
        }
        rowSelection={
          isAdmin
            ? {
                selectedRowKeys,
                onChange: (keys, rows) => {
                  setSelectedRowKeys(keys);
                  onSelectionChange?.(keys, rows);
                },
              }
            : undefined
        }
        pagination={
          search
            ? { pageSize: 1000, hideOnSinglePage: true, showTotal: (t) => `${t} result${t !== 1 ? "s" : ""}` }
            : {
                current: page,
                pageSize,
                total: data?.total ?? 0,
                showSizeChanger: true,
                pageSizeOptions: ["25", "50", "100"],
                onChange: (p, ps) => { setPage(p); setPageSize(ps); },
              }
        }
        size="small"
        scroll={{ x: true }}
      />

      <Modal
        title={editing ? `Edit ${title}` : `New ${title}`}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnClose
        width={modalWidth}
        okText={editing ? "Save" : "Create"}
      >
        <Form form={form} layout="vertical" className="crud-form crud-form-compact">
          {renderFormFields(formFields, { includeExtraContent: true })}
        </Form>
      </Modal>

      <Modal
        title={quickCreateField?.quickCreate?.title ?? quickCreateField?.quickCreate?.actionLabel ?? `Create ${quickCreateField?.label ?? "record"}`}
        open={quickCreateOpen}
        onOk={submitQuickCreate}
        onCancel={closeQuickCreate}
        confirmLoading={quickCreateLoading}
        destroyOnClose
        width={720}
        okText="Create"
      >
        <Form form={quickCreateForm} layout="vertical" className="crud-form crud-form-compact">
          {renderFormFields(quickCreateField?.quickCreate?.fields ?? [], { inQuickCreate: true })}
        </Form>
      </Modal>

      <Modal
        title={`Bulk Edit ${selectedRowKeys.length} record(s)`}
        open={bulkEditOpen}
        onOk={handleBulkEdit}
        onCancel={closeBulkEdit}
        confirmLoading={bulkEditLoading}
        destroyOnClose
        width={modalWidth}
        okText="Apply Changes"
      >
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Only filled fields will be applied to all selected records.
        </Typography.Text>
        <Form form={bulkForm} layout="vertical" className="crud-form crud-form-compact">
          {renderFormFields(formFields, { enforceRequired: false })}
        </Form>
      </Modal>
    </div>
  );
}
