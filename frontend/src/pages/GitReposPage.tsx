/**
 * GitReposPage — Manage git repositories (Ansible playbook repos + App repos).
 *
 * Features:
 * - List repos in a table
 * - Create / Edit repos (with HTTPS and SSH key auth)
 * - Sync a repo (clone/pull + discover playbooks)
 * - Import App from repo (opens AppImportModal for preview)
 * - Delete a repo
 */
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  BranchesOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  KeyOutlined,
  LockOutlined,
  PlusOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createGitCredential,
  createGitRepo,
  listGitCredentials,
  deleteGitRepo,
  listGitRepos,
  clearGitKnownHostsForRepo,
  syncGitRepo,
  updateGitRepo,
} from "../api/git";
import { useAuth } from "../store/AuthContext";
import AppImportModal from "../components/AppImportModal";
import BulkAppImportModal from "../components/BulkAppImportModal";
import RoleImportModal from "../components/RoleImportModal";
import type { GitAuthType, GitCredential, GitRepo, GitRepoCreate, GitRepoType } from "../types";
import { buildSortedOptions, filterSelectOption } from "../utils/selectOptions";

const { Text, Title } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const REPO_TYPE_COLOR: Record<GitRepoType, string> = {
  ansible: "blue",
  app: "green",
};

const AUTH_TYPE_LABELS: Record<GitAuthType, string> = {
  none: "Public",
  https: "HTTPS",
  ssh: "SSH Key",
};

interface RepoFormValues {
  name: string;
  url: string;
  branch: string;
  repo_type: GitRepoType;
  auth_type: GitAuthType;
  credential_id?: number;
  https_username?: string;
  https_password?: string;
  ssh_private_key?: string;
}

export default function GitReposPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data, isLoading } = useQuery({
    queryKey: ["/git-repos"],
    queryFn: () => listGitRepos(0, 200),
  });
  const { data: credentialData } = useQuery({
    queryKey: ["/git-credentials"],
    queryFn: () => listGitCredentials(0, 200),
    enabled: isAdmin,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState<GitRepo | null>(null);
  const [importRepo, setImportRepo] = useState<GitRepo | null>(null);
  const [bulkImportRepo, setBulkImportRepo] = useState<GitRepo | null>(null);
  const [roleImportRepo, setRoleImportRepo] = useState<GitRepo | null>(null);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [form] = Form.useForm<RepoFormValues>();
  const authType = Form.useWatch("auth_type", form);
  const selectedCredentialId = Form.useWatch("credential_id", form);
  const selectedCredential = (credentialData?.items ?? []).find((item) => item.id === selectedCredentialId) ?? null;


  const createMutation = useMutation({
    mutationFn: (values: GitRepoCreate) => createGitRepo(values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/git-repos"] });
      message.success("Repository created.");
      setModalOpen(false);
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail ?? "Failed to create repository.");
    },
  });

  const createCredentialMutation = useMutation({
    mutationFn: createGitCredential,
    onSuccess: async (credential) => {
      await qc.invalidateQueries({ queryKey: ["/git-credentials"] });
      form.setFieldsValue({
        credential_id: credential.id,
        auth_type: credential.auth_type,
        https_username: credential.https_username ?? undefined,
      });
      message.success("Git credential created and selected.");
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail ?? "Failed to create credential.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<GitRepoCreate> }) =>
      updateGitRepo(id, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/git-repos"] });
      message.success("Repository updated.");
      setModalOpen(false);
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail ?? "Failed to update repository.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteGitRepo(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/git-repos"] });
      message.success("Repository deleted.");
    },
  });

  const clearKnownHostsMutation = useMutation({
    mutationFn: (id: number) => clearGitKnownHostsForRepo(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["/admin/ssh-known-hosts"] });
      message.success(`Cleared SSH cache for ${result.aliases.join(", ")}`);
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail ?? "Failed to clear remote host key cache.");
    },
  });


  function openCreate() {
    setEditingRepo(null);
    form.resetFields();
    form.setFieldsValue({ branch: "main", repo_type: "ansible", auth_type: "none", credential_id: undefined });
    setModalOpen(true);
  }

  function openEdit(repo: GitRepo) {
    setEditingRepo(repo);
    form.setFieldsValue({
      name: repo.name,
      url: repo.url,
      branch: repo.branch,
      repo_type: repo.repo_type,
      auth_type: repo.auth_type,
      credential_id: repo.credential_id ?? undefined,
      https_username: repo.https_username ?? undefined,
    });
    setModalOpen(true);
  }

  function handleSubmit(values: RepoFormValues) {
    const payload: GitRepoCreate = {
      name: values.name,
      url: values.url,
      branch: values.branch || "main",
      repo_type: values.repo_type,
      auth_type: values.auth_type,
      credential_id: values.credential_id ?? undefined,
      https_username: values.credential_id ? undefined : values.https_username || undefined,
      // Credentials only sent when provided (avoids clearing stored secret on edit)
      ...(!values.credential_id && values.https_password ? { https_password: values.https_password } : {}),
      ...(!values.credential_id && values.ssh_private_key ? { ssh_private_key: values.ssh_private_key } : {}),
    };

    if (editingRepo) {
      updateMutation.mutate({ id: editingRepo.id, values: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  async function handleSync(repo: GitRepo) {
    setSyncing(repo.id);
    try {
      const result = await syncGitRepo(repo.id);
      message.success(result.message);
      qc.invalidateQueries({ queryKey: ["/git-repos"] });
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail ?? "Sync failed.");
    } finally {
      setSyncing(null);
    }
  }


  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      render: (name: string, rec: GitRepo) => (
        <Space>
          <Text strong>{name}</Text>
          <Tag color={REPO_TYPE_COLOR[rec.repo_type]}>{rec.repo_type}</Tag>
        </Space>
      ),
    },
    {
      title: "URL",
      dataIndex: "url",
      render: (url: string) => (
        <Text code style={{ fontSize: 12 }}>
          {url}
        </Text>
      ),
    },
    {
      title: "Branch",
      dataIndex: "branch",
      width: 120,
      render: (b: string) => (
        <Space size={4}>
          <BranchesOutlined />
          {b}
        </Space>
      ),
    },
    {
      title: "Auth",
      dataIndex: "auth_type",
      width: 110,
      render: (at: GitAuthType, rec: GitRepo) => (
        <Space size={4}>
          {at !== "none" && <LockOutlined />}
          {AUTH_TYPE_LABELS[at]}
          {rec.credential_name && <Tag color="purple">{rec.credential_name}</Tag>}
          {rec.has_https_password && <Tag>pw</Tag>}
          {rec.has_ssh_key && <Tag>key</Tag>}
        </Space>
      ),
    },
    {
      title: "Last Synced",
      dataIndex: "last_synced_at",
      width: 160,
      render: (v: string | null) =>
        v ? new Date(v).toLocaleString() : <Text type="secondary">Never</Text>,
    },
    {
      title: "Actions",
      key: "actions",
      width: 200,
      render: (_: unknown, rec: GitRepo) => (
        <Space>
          <Tooltip title="Sync (clone/pull)">
            <Button
              size="small"
              icon={<SyncOutlined spin={syncing === rec.id} />}
              onClick={() => handleSync(rec)}
              loading={syncing === rec.id}
              disabled={!isAdmin}
            />
          </Tooltip>
          {rec.repo_type === "app" && (
            <Tooltip title="Bulk Import Apps">
              <Button
                size="small"
                icon={<ImportOutlined />}
                onClick={() => setBulkImportRepo(rec)}
                disabled={!isAdmin}
              />
            </Tooltip>
          )}
          {rec.repo_type === "ansible" && (
            <Tooltip title="Import Roles">
              <Button
                size="small"
                icon={<ImportOutlined />}
                onClick={() => setRoleImportRepo(rec)}
                disabled={!isAdmin}
              />
            </Tooltip>
          )}
          {rec.auth_type === "ssh" && (
            <Popconfirm
              title="Clear cached SSH host key?"
              description="Use this after the Git remote is redeployed or rotates its SSH host key."
              onConfirm={() => clearKnownHostsMutation.mutate(rec.id)}
              okText="Clear"
              cancelText="Cancel"
            >
              <Tooltip title="Clear remote host key">
                <Button
                  size="small"
                  icon={<KeyOutlined />}
                  disabled={!isAdmin}
                  loading={clearKnownHostsMutation.isPending}
                />
              </Tooltip>
            </Popconfirm>
          )}
          <Tooltip title="Edit">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(rec)}
              disabled={!isAdmin}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this repository?"
            onConfirm={() => deleteMutation.mutate(rec.id)}
            disabled={!isAdmin}
          >
            <Button size="small" danger icon={<DeleteOutlined />} disabled={!isAdmin} />
          </Popconfirm>
        </Space>
      ),
    },
  ];


  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          Git Repositories
        </Title>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add Repository
          </Button>
        )}
      </div>

      <Table
        size="small"
        loading={isLoading}
        dataSource={data?.items ?? []}
        columns={columns}
        rowKey="id"
        pagination={{ pageSize: 50 }}
      />

      {/* Create / Edit Modal */}
      <Modal
        title={editingRepo ? `Edit Repository: ${editingRepo.name}` : "Add Git Repository"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width={560}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ branch: "main", repo_type: "ansible", auth_type: "none" }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="my-ansible-repo" />
          </Form.Item>

          <Form.Item name="url" label="Repository URL" rules={[{ required: true }]}>
            <Input placeholder="https://github.com/org/repo.git" />
          </Form.Item>

          <Space style={{ width: "100%" }} size="middle">
            <Form.Item name="branch" label="Branch" style={{ flex: 1 }}>
              <Input placeholder="main" />
            </Form.Item>

            <Form.Item name="repo_type" label="Type" style={{ flex: 1 }}>
              <Select>
                <Option value="ansible">Ansible</Option>
                <Option value="app">App (Docker Compose)</Option>
              </Select>
            </Form.Item>
          </Space>

          <Form.Item name="auth_type" label="Authentication">
            <Select disabled={!!selectedCredential}>
              <Option value="none">Public (no auth)</Option>
              <Option value="https">HTTPS (username + token/password)</Option>
              <Option value="ssh">SSH Private Key</Option>
            </Select>
          </Form.Item>

          <Form.Item name="credential_id" label="Saved Credential">
            <Select
              allowClear
              placeholder="Optional reusable credential"
              showSearch
              filterOption={filterSelectOption}
              options={buildSortedOptions(credentialData?.items ?? [], (credential) => ({
                value: credential.id,
                label: `${credential.name} (${AUTH_TYPE_LABELS[credential.auth_type]})`,
                searchText: `${credential.name} ${AUTH_TYPE_LABELS[credential.auth_type]}`,
              }))}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <Button
                    type="link"
                    block
                    onClick={async () => {
                      const authTypeValue = (form.getFieldValue("auth_type") as GitAuthType | undefined) ?? "https";
                      const httpsUsername = form.getFieldValue("https_username") as string | undefined;
                      const httpsPassword = form.getFieldValue("https_password") as string | undefined;
                      const sshPrivateKey = form.getFieldValue("ssh_private_key") as string | undefined;
                      if ((authTypeValue === "https" && !httpsPassword) || (authTypeValue === "ssh" && !sshPrivateKey)) {
                        message.warning("Enter the current repo credential details first, then save them for reuse.");
                        return;
                      }
                      const baseName = form.getFieldValue("name") || "Git Credential";
                      createCredentialMutation.mutate({
                        name: `${baseName} Credential`,
                        auth_type: authTypeValue,
                        https_username: authTypeValue === "https" ? httpsUsername : undefined,
                        https_password: authTypeValue === "https" ? httpsPassword : undefined,
                        ssh_private_key: authTypeValue === "ssh" ? sshPrivateKey : undefined,
                      });
                    }}
                    loading={createCredentialMutation.isPending}
                    style={{ textAlign: "left" }}
                  >
                    Save current credential for reuse
                  </Button>
                </>
              )}
              onChange={(value) => {
                const credential = (credentialData?.items ?? []).find((item) => item.id === value) ?? null;
                form.setFieldsValue({
                  auth_type: credential?.auth_type ?? form.getFieldValue("auth_type"),
                  https_username: credential?.https_username ?? undefined,
                  https_password: undefined,
                  ssh_private_key: undefined,
                });
              }}
            />
          </Form.Item>

          {selectedCredential && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`Using saved credential: ${selectedCredential.name}`}
              description="This repository will reuse the selected credential. Inline password and key fields are ignored while a saved credential is selected."
            />
          )}

          {authType === "https" && !selectedCredential && (
            <>
              <Form.Item name="https_username" label="Username">
                <Input placeholder="git" />
              </Form.Item>
              <Form.Item name="https_password" label="Password / Token">
                <Input.Password
                  placeholder={editingRepo?.has_https_password ? "Leave blank to keep existing" : ""}
                />
              </Form.Item>
            </>
          )}

          {authType === "ssh" && !selectedCredential && (
            <Form.Item name="ssh_private_key" label="SSH Private Key">
              <TextArea
                rows={6}
                placeholder={
                  editingRepo?.has_ssh_key
                    ? "Leave blank to keep existing key"
                    : "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
                }
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={createMutation.isPending || updateMutation.isPending}
              >
                {editingRepo ? "Save" : "Create"}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* App Import Modal */}
      {importRepo && (
        <AppImportModal
          repo={importRepo}
          open={!!importRepo}
          onClose={() => setImportRepo(null)}
          onImported={() => {
            setImportRepo(null);
            qc.invalidateQueries({ queryKey: ["/apps"] });
          }}
        />
      )}

      <BulkAppImportModal
        repo={bulkImportRepo}
        open={!!bulkImportRepo}
        onClose={() => setBulkImportRepo(null)}
        onImported={() => {
          setBulkImportRepo(null);
          qc.invalidateQueries({ queryKey: ["/apps"] });
        }}
      />

      <RoleImportModal
        repo={roleImportRepo}
        open={!!roleImportRepo}
        onClose={() => setRoleImportRepo(null)}
        onImported={() => qc.invalidateQueries({ queryKey: ["/roles"] })}
      />
    </div>
  );
}
