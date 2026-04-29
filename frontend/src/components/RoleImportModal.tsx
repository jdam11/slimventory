/**
 * RoleImportModal — discover and import Ansible roles from a git repo.
 *
 * Shows discovered roles from roles/ with description (editable) and a
 * per-role toggle for importing defaults/main.yml as RoleField rows.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { importRoles, previewRoles } from "../api/git";
import type { AnsibleRolePreview, GitRepo, RoleImportItem } from "../types";

const { Text } = Typography;

interface RowState {
  selected: boolean;
  description: string;
  import_defaults: boolean;
}

interface Props {
  repo: GitRepo | null;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function RoleImportModal({ repo, open, onClose, onImported }: Props) {
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [discovered, setDiscovered] = useState<AnsibleRolePreview[]>([]);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: { name: string; detail: string }[] } | null>(null);

  useEffect(() => {
    if (!open || !repo) return;
    setDiscovered([]);
    setRowState({});
    setError(null);
    setResult(null);
    setLoading(true);

    previewRoles(repo.id)
      .then((roles) => {
        setDiscovered(roles);
        const initial: Record<string, RowState> = {};
        for (const r of roles) {
          initial[r.name] = {
            selected: true,
            description: r.description ?? "",
            import_defaults: Object.keys(r.defaults).length > 0,
          };
        }
        setRowState(initial);
      })
      .catch((e: unknown) => {
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(detail ?? "Failed to scan roles.");
      })
      .finally(() => setLoading(false));
  }, [open, repo]);

  function patch(name: string, update: Partial<RowState>) {
    setRowState((prev) => ({ ...prev, [name]: { ...prev[name], ...update } }));
  }

  async function handleImport() {
    if (!repo) return;
    const items: RoleImportItem[] = discovered
      .filter((r) => rowState[r.name]?.selected)
      .map((r) => ({
        name: r.name,
        description: rowState[r.name].description || null,
        import_defaults: rowState[r.name].import_defaults,
      }));

    if (!items.length) {
      message.warning("No roles selected.");
      return;
    }

    setImporting(true);
    try {
      const res = await importRoles(repo.id, items);
      setResult(res);
      if (res.created > 0) {
        onImported();
      }
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail ?? "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  const selectedCount = Object.values(rowState).filter((s) => s.selected).length;

  const columns = [
    {
      title: "",
      width: 36,
      render: (_: unknown, rec: AnsibleRolePreview) => (
        <Checkbox
          checked={rowState[rec.name]?.selected ?? true}
          onChange={(e) => patch(rec.name, { selected: e.target.checked })}
        />
      ),
    },
    {
      title: "Role",
      dataIndex: "name",
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: "Description",
      render: (_: unknown, rec: AnsibleRolePreview) => (
        <Input
          size="small"
          value={rowState[rec.name]?.description ?? ""}
          placeholder="Optional description"
          onChange={(e) => patch(rec.name, { description: e.target.value })}
          disabled={!rowState[rec.name]?.selected}
        />
      ),
    },
    {
      title: "Import defaults",
      width: 140,
      render: (_: unknown, rec: AnsibleRolePreview) => {
        const count = Object.keys(rec.defaults).length;
        if (count === 0) return <Text type="secondary">None</Text>;
        return (
          <Space size={6}>
            <Checkbox
              checked={rowState[rec.name]?.import_defaults ?? true}
              onChange={(e) => patch(rec.name, { import_defaults: e.target.checked })}
              disabled={!rowState[rec.name]?.selected}
            />
            <Tag>{count} var{count !== 1 ? "s" : ""}</Tag>
          </Space>
        );
      },
    },
  ];

  return (
    <Modal
      title={`Import Roles from ${repo?.name ?? ""}`}
      open={open}
      onCancel={onClose}
      width={760}
      footer={
        result ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              type="primary"
              loading={importing}
              disabled={loading || selectedCount === 0}
              onClick={() => void handleImport()}
            >
              Import {selectedCount > 0 ? `${selectedCount} role${selectedCount !== 1 ? "s" : ""}` : ""}
            </Button>
          </Space>
        )
      }
    >
      {loading && (
        <div style={{ textAlign: "center", padding: 32 }}>
          <Spin tip="Scanning roles/…" />
        </div>
      )}

      {error && <Alert type="error" showIcon message={error} />}

      {result && (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert
            type={result.errors.length ? "warning" : "success"}
            showIcon
            message={`Created ${result.created}, skipped ${result.skipped}${result.errors.length ? `, ${result.errors.length} error(s)` : ""}`}
          />
          {result.errors.map((e) => (
            <Alert key={e.name} type="error" showIcon message={`${e.name}: ${e.detail}`} />
          ))}
        </Space>
      )}

      {!loading && !error && !result && (
        <>
          {discovered.length === 0 ? (
            <Alert
              type="info"
              showIcon
              message="No roles/ directory found in this repo."
              description="Make sure the repo has been synced and contains a roles/ directory."
            />
          ) : (
            <>
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary">
                  {discovered.length} role{discovered.length !== 1 ? "s" : ""} found.
                  Edit descriptions or uncheck roles you don't want to import.
                </Text>
              </div>
              <Table
                size="small"
                rowKey="name"
                dataSource={discovered}
                columns={columns}
                pagination={false}
              />
            </>
          )}
        </>
      )}
    </Modal>
  );
}
