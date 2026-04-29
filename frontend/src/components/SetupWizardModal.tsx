import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Steps,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  ClusterOutlined,
  CodeOutlined,
  DatabaseOutlined,
  RocketOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { createRecord, listRecords } from "../api/crud";
import { createProxmoxCredential, type ProxmoxCredentialInput } from "../api/proxmox";
import type { AnsibleDefault, Environment, Role, Vlan } from "../types";

const { Title, Text, Paragraph } = Typography;

const WIZARD_KEY = "slim_setup_wizard_complete";

export function isWizardComplete(): boolean {
  return localStorage.getItem(WIZARD_KEY) === "1";
}

export function markWizardComplete(): void {
  localStorage.setItem(WIZARD_KEY, "1");
}

const STEPS = [
  { title: "Welcome" },
  { title: "Environment" },
  { title: "VLAN" },
  { title: "Role" },
  { title: "Proxmox" },
  { title: "Ansible" },
  { title: "Done" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SetupWizardModal({ open, onClose }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [current, setCurrent] = useState(0);
  const [envForm] = Form.useForm();
  const [vlanForm] = Form.useForm();
  const [roleForm] = Form.useForm();
  const [proxmoxForm] = Form.useForm();
  const [ansibleForm] = Form.useForm();

  const selectedAuthType = Form.useWatch("auth_type", proxmoxForm) ?? "token";
  const selectedBecome = Form.useWatch("ansible_become", ansibleForm) ?? false;

  const { data: envData } = useQuery({
    queryKey: ["/environments", "wizard-check"],
    queryFn: () => listRecords<Environment>("/environments", 0, 1),
    enabled: open,
  });
  const { data: vlanData } = useQuery({
    queryKey: ["/vlans", "wizard-check"],
    queryFn: () => listRecords<Vlan>("/vlans", 0, 1),
    enabled: open,
  });
  const { data: roleData } = useQuery({
    queryKey: ["/roles", "wizard-check"],
    queryFn: () => listRecords<Role>("/roles", 0, 1),
    enabled: open,
  });
  const { data: ansibleData } = useQuery({
    queryKey: ["/ansible-defaults", "wizard-check"],
    queryFn: () => api.get<AnsibleDefault[]>("/ansible-defaults/").then((r) => r.data),
    enabled: open,
  });

  const envMut = useMutation({
    mutationFn: (data: { name: string }) => createRecord<Environment>("/environments", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/environments"] });
      advance();
    },
    onError: (e: unknown) =>
      message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to create environment"),
  });

  const vlanMut = useMutation({
    mutationFn: (data: { vlan_id: number; subnet?: string; description?: string }) =>
      createRecord<Vlan>("/vlans", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/vlans"] });
      advance();
    },
    onError: (e: unknown) =>
      message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to create VLAN"),
  });

  const roleMut = useMutation({
    mutationFn: (data: { name: string; description?: string }) => createRecord<Role>("/roles", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/roles"] });
      advance();
    },
    onError: (e: unknown) =>
      message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to create role"),
  });

  const proxmoxMut = useMutation({
    mutationFn: (data: ProxmoxCredentialInput) => createProxmoxCredential(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/proxmox/credentials"] });
      advance();
    },
    onError: (e: unknown) =>
      message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to add credential"),
  });

  const ansibleMut = useMutation({
    mutationFn: (fields: Record<string, string>) =>
      api.put("/ansible-defaults/yaml", { fields }),
    onSuccess: () => advance(),
    onError: (e: unknown) =>
      message.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to save Ansible defaults"),
  });

  function advance() {
    setCurrent((c) => c + 1);
  }

  function handleClose() {
    markWizardComplete();
    onClose();
  }

  function handleFinish() {
    markWizardComplete();
    onClose();
    navigate("/inventory/hypervisors/proxmox");
  }

  function handleEnvNext() {
    envForm
      .validateFields()
      .then((vals) => envMut.mutate(vals))
      .catch(() => null);
  }

  function handleVlanNext() {
    vlanForm
      .validateFields()
      .then((vals) => vlanMut.mutate(vals))
      .catch(() => null);
  }

  function handleRoleNext() {
    roleForm
      .validateFields()
      .then((vals) => roleMut.mutate(vals))
      .catch(() => null);
  }

  function handleProxmoxNext() {
    proxmoxForm
      .validateFields()
      .then((vals) => proxmoxMut.mutate(vals))
      .catch(() => null);
  }

  function handleAnsibleNext() {
    const vals = ansibleForm.getFieldsValue();
    const fields: Record<string, string> = {};
    if (vals.ansible_user) fields.ansible_user = vals.ansible_user;
    if (vals.ansible_port != null && vals.ansible_port !== 22)
      fields.ansible_port = String(vals.ansible_port);
    if (vals.ansible_become) {
      fields.ansible_become = "true";
      if (vals.ansible_become_method)
        fields.ansible_become_method = vals.ansible_become_method;
    }
    if (Object.keys(fields).length === 0) {
      advance();
      return;
    }
    ansibleMut.mutate(fields);
  }

  const alreadyHasEnvs = (envData?.total ?? 0) > 0;
  const alreadyHasVlans = (vlanData?.total ?? 0) > 0;
  const alreadyHasRoles = (roleData?.total ?? 0) > 0;
  const alreadyHasAnsibleDefaults = (ansibleData?.length ?? 0) > 0;

  const stepContent: Record<number, React.ReactNode> = {
    0: (
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <div style={{ textAlign: "center", padding: "16px 0 8px" }}>
          <img src="/logo.svg" alt="SLIM" style={{ height: 48, marginBottom: 16 }} />
          <Title level={3} style={{ margin: 0 }}>Welcome to SLIM</Title>
          <Text type="secondary">Simple Lab Inventory Manager</Text>
        </div>
        <Paragraph>
          Before your first Proxmox import, SLIM needs a few reference records that hosts
          will be tagged with:
        </Paragraph>
        <Space direction="vertical" size={8}>
          <Space>
            <DatabaseOutlined style={{ color: "#1677ff" }} />
            <Text><Text strong>Environment</Text> — e.g. <Text code>homelab</Text>, <Text code>prod</Text>, <Text code>dev</Text></Text>
          </Space>
          <Space>
            <ClusterOutlined style={{ color: "#1677ff" }} />
            <Text><Text strong>VLAN</Text> — the network segment your hosts live on</Text>
          </Space>
          <Space>
            <TagsOutlined style={{ color: "#1677ff" }} />
            <Text><Text strong>Role</Text> — e.g. <Text code>server</Text>, <Text code>router</Text>, <Text code>storage</Text></Text>
          </Space>
          <Space>
            <RocketOutlined style={{ color: "#1677ff" }} />
            <Text><Text strong>Proxmox Credential</Text> — API token or login for your PVE node</Text>
          </Space>
          <Space>
            <CodeOutlined style={{ color: "#1677ff" }} />
            <Text><Text strong>Ansible Defaults</Text> — SSH user, port, and privilege escalation settings</Text>
          </Space>
        </Space>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          You can skip any step and fill in the details later, but hosts imported without
          defaults will land in the pending queue until all fields are filled.
        </Paragraph>
      </Space>
    ),

    1: (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Create an Environment</Title>
          <Text type="secondary">
            Environments group hosts by deployment context. Proxmox sync uses a default
            environment when auto-promoting discovered hosts.
          </Text>
        </div>
        {alreadyHasEnvs && (
          <Alert
            type="success"
            showIcon
            message="You already have at least one environment."
            description="You can skip this step or create an additional one."
          />
        )}
        <Form form={envForm} layout="vertical">
          <Form.Item
            name="name"
            label="Environment Name"
            rules={[{ required: true, message: "Name is required" }]}
          >
            <Input placeholder="e.g. homelab" autoFocus />
          </Form.Item>
        </Form>
      </Space>
    ),

    2: (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Create a VLAN</Title>
          <Text type="secondary">
            VLANs define the network segments in your lab. At least one is needed for
            Proxmox auto-promotion to work.
          </Text>
        </div>
        {alreadyHasVlans && (
          <Alert
            type="success"
            showIcon
            message="You already have at least one VLAN."
            description="You can skip this step or create an additional one."
          />
        )}
        <Form form={vlanForm} layout="vertical">
          <Form.Item
            name="vlan_id"
            label="VLAN ID"
            rules={[{ required: true, message: "VLAN ID is required" }]}
          >
            <InputNumber min={1} max={4094} style={{ width: "100%" }} placeholder="e.g. 10" />
          </Form.Item>
          <Form.Item name="subnet" label="Subnet">
            <Input placeholder="e.g. 192.168.10.0/24" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input placeholder="e.g. Main LAN" />
          </Form.Item>
        </Form>
      </Space>
    ),

    3: (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Create a Role</Title>
          <Text type="secondary">
            Roles classify what a host does. Proxmox-discovered hosts are assigned a
            default role during auto-promotion.
          </Text>
        </div>
        {alreadyHasRoles && (
          <Alert
            type="success"
            showIcon
            message="You already have at least one role."
            description="You can skip this step or create an additional one."
          />
        )}
        <Form form={roleForm} layout="vertical">
          <Form.Item
            name="name"
            label="Role Name"
            rules={[{ required: true, message: "Name is required" }]}
          >
            <Input placeholder="e.g. server" autoFocus />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input placeholder="e.g. General-purpose server" />
          </Form.Item>
        </Form>
      </Space>
    ),

    4: (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Add a Proxmox Credential</Title>
          <Text type="secondary">
            Connect SLIM to your Proxmox VE node or cluster. You can use an API token
            (recommended) or username/password.
          </Text>
        </div>
        <Form
          form={proxmoxForm}
          layout="vertical"
          initialValues={{ auth_type: "token", verify_tls: true, is_active: true }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. pve-main" />
          </Form.Item>
          <Form.Item name="base_url" label="Base URL" rules={[{ required: true }]}>
            <Input placeholder="https://proxmox.local:8006" />
          </Form.Item>
          <Form.Item name="auth_type" label="Auth Type" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "token", label: "API Token" },
                { value: "password", label: "Username / Password" },
              ]}
            />
          </Form.Item>
          {selectedAuthType === "token" && (
            <>
              <Form.Item name="token_id" label="Token ID" rules={[{ required: true }]}>
                <Input placeholder="user@pam!token-name" />
              </Form.Item>
              <Form.Item name="token_secret" label="Token Secret" rules={[{ required: true }]}>
                <Input.Password placeholder="Secret UUID" />
              </Form.Item>
            </>
          )}
          {selectedAuthType === "password" && (
            <>
              <Form.Item name="username" label="Username" rules={[{ required: true }]}>
                <Input placeholder="root@pam" />
              </Form.Item>
              <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                <Input.Password />
              </Form.Item>
            </>
          )}
          <Form.Item name="verify_tls" label="Verify TLS" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="is_active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Space>
    ),

    5: (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Set Ansible Defaults</Title>
          <Text type="secondary">
            Global SSH settings used by Ansible when running playbooks against your hosts.
            These can be overridden per-host later.
          </Text>
        </div>
        {alreadyHasAnsibleDefaults && (
          <Alert
            type="success"
            showIcon
            message="You already have Ansible defaults configured."
            description="Skip this step, or fill in the form below to replace them."
          />
        )}
        <Form
          form={ansibleForm}
          layout="vertical"
          initialValues={{ ansible_port: 22, ansible_become: false, ansible_become_method: "sudo" }}
        >
          <Form.Item name="ansible_user" label="Remote User">
            <Input placeholder="e.g. ubuntu, ansible, root" />
          </Form.Item>
          <Form.Item name="ansible_port" label="SSH Port">
            <InputNumber min={1} max={65535} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="ansible_become" label="Privilege Escalation (become)" valuePropName="checked">
            <Switch />
          </Form.Item>
          {selectedBecome && (
            <Form.Item name="ansible_become_method" label="Become Method">
              <Select
                options={[
                  { value: "sudo", label: "sudo" },
                  { value: "su", label: "su" },
                  { value: "doas", label: "doas" },
                  { value: "pbrun", label: "pbrun" },
                  { value: "pfexec", label: "pfexec" },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Space>
    ),

    6: (
      <Space direction="vertical" size={20} style={{ width: "100%", textAlign: "center", padding: "16px 0" }}>
        <CheckCircleOutlined style={{ fontSize: 56, color: "#52c41a" }} />
        <div>
          <Title level={3} style={{ margin: 0 }}>Setup complete!</Title>
          <Text type="secondary">SLIM is ready for your first Proxmox import.</Text>
        </div>
        <Paragraph>
          Head to the <Text strong>Proxmox</Text> page to trigger your first sync. Discovered
          hosts that match your defaults will be promoted automatically. Any that need
          manual review will appear in the pending queue.
        </Paragraph>
        <Space>
          <Tag color="blue">Tip</Tag>
          <Text type="secondary">
            Set <Text code>PROXMOX_DEFAULT_ENVIRONMENT_ID</Text>,{" "}
            <Text code>PROXMOX_DEFAULT_VLAN_ID</Text>, and{" "}
            <Text code>PROXMOX_DEFAULT_ROLE_ID</Text> in your <Text code>.env</Text> to
            auto-promote hosts without the pending queue.
          </Text>
        </Space>
      </Space>
    ),
  };

  const footerContent: Record<number, React.ReactNode> = {
    0: (
      <Space style={{ justifyContent: "flex-end", width: "100%", display: "flex" }}>
        <Button onClick={handleClose}>Skip setup</Button>
        <Button type="primary" onClick={advance}>
          Get Started
        </Button>
      </Space>
    ),
    1: (
      <Space style={{ justifyContent: "space-between", width: "100%", display: "flex" }}>
        <Button onClick={advance}>Skip</Button>
        <Button type="primary" loading={envMut.isPending} onClick={handleEnvNext}>
          Create & Continue
        </Button>
      </Space>
    ),
    2: (
      <Space style={{ justifyContent: "space-between", width: "100%", display: "flex" }}>
        <Button onClick={advance}>Skip</Button>
        <Button type="primary" loading={vlanMut.isPending} onClick={handleVlanNext}>
          Create & Continue
        </Button>
      </Space>
    ),
    3: (
      <Space style={{ justifyContent: "space-between", width: "100%", display: "flex" }}>
        <Button onClick={advance}>Skip</Button>
        <Button type="primary" loading={roleMut.isPending} onClick={handleRoleNext}>
          Create & Continue
        </Button>
      </Space>
    ),
    4: (
      <Space style={{ justifyContent: "space-between", width: "100%", display: "flex" }}>
        <Button onClick={advance}>Skip</Button>
        <Button type="primary" loading={proxmoxMut.isPending} onClick={handleProxmoxNext}>
          Add & Continue
        </Button>
      </Space>
    ),
    5: (
      <Space style={{ justifyContent: "space-between", width: "100%", display: "flex" }}>
        <Button onClick={advance}>Skip</Button>
        <Button type="primary" loading={ansibleMut.isPending} onClick={handleAnsibleNext}>
          Save & Continue
        </Button>
      </Space>
    ),
    6: (
      <Space style={{ justifyContent: "flex-end", width: "100%", display: "flex" }}>
        <Button onClick={handleClose}>Close</Button>
        <Button type="primary" icon={<RocketOutlined />} onClick={handleFinish}>
          Go to Proxmox
        </Button>
      </Space>
    ),
  };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title="SLIM Setup Guide"
      width={600}
      footer={footerContent[current]}
      destroyOnClose
    >
      <Steps
        current={current}
        items={STEPS}
        size="small"
        style={{ marginBottom: 28 }}
      />
      {stepContent[current]}
    </Modal>
  );
}
