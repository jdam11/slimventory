import { Alert, Button, Card, Descriptions, Divider, Form, Input, Space, Switch, Typography, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getAnsibleRunnerSettings, getSshKnownHostsSummary, updateAnsibleRunnerSettings } from "../../api/admin";
import type { AnsibleRunnerSettingsUpdate } from "../../types";

const { Title, Text, Paragraph } = Typography;

interface FormValues {
  kerberos_enabled: boolean;
  kerberos_krb5_conf?: string;
  kerberos_ccache_name?: string;
}

const WINDOWS_KERBEROS_SNIPPET = `ansible_connection: winrm
ansible_port: 5986
ansible_winrm_transport: kerberos
ansible_shell_type: powershell
ansible_shell_executable: powershell.exe`;

export default function AnsibleRunnerSettingsPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm<FormValues>();

  const settingsQuery = useQuery({
    queryKey: ["/admin/ansible-runner-settings"],
    queryFn: getAnsibleRunnerSettings,
  });
  const knownHostsQuery = useQuery({
    queryKey: ["/admin/ssh-known-hosts"],
    queryFn: getSshKnownHostsSummary,
  });

  const saveMutation = useMutation({
    mutationFn: (payload: AnsibleRunnerSettingsUpdate) => updateAnsibleRunnerSettings(payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/admin/ansible-runner-settings"] });
      form.setFieldsValue({
        kerberos_enabled: data.kerberos_enabled,
        kerberos_krb5_conf: data.kerberos_krb5_conf ?? "",
        kerberos_ccache_name: data.kerberos_ccache_name ?? "",
      });
      message.success("Ansible runner settings saved.");
    },
    onError: (error: unknown) => {
      message.error(
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to save Ansible runner settings."
      );
    },
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }
    form.setFieldsValue({
      kerberos_enabled: settingsQuery.data.kerberos_enabled,
      kerberos_krb5_conf: settingsQuery.data.kerberos_krb5_conf ?? "",
      kerberos_ccache_name: settingsQuery.data.kerberos_ccache_name ?? "",
    });
  }, [form, settingsQuery.data]);

  const kerberosEnabled = Form.useWatch("kerberos_enabled", form) ?? false;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          Ansible Runner Settings
        </Title>
        <Text type="secondary">
          Admin-only runtime settings for the automation worker. Kerberos support applies to playbook runs executed by the ansible-runner sidecar.
        </Text>
      </div>
      <Divider />

      <Card style={{ maxWidth: 960 }}>
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={{ kerberos_enabled: false, kerberos_krb5_conf: "", kerberos_ccache_name: "" }}
          onFinish={(values) =>
            saveMutation.mutate({
              kerberos_enabled: values.kerberos_enabled,
              kerberos_krb5_conf: values.kerberos_krb5_conf ?? null,
              kerberos_ccache_name: values.kerberos_ccache_name ?? null,
            })
          }
        >
          <Form.Item
            label="Enable Kerberos Support"
            name="kerberos_enabled"
            valuePropName="checked"
          >
            <Switch loading={settingsQuery.isLoading} />
          </Form.Item>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Windows host inventory vars"
            description={
              <div>
                <Paragraph style={{ marginBottom: 8 }}>
                  Kerberos in the runner only enables the transport stack. Your Windows hosts still need the correct inventory vars, typically through host type fields, role fields, or Ansible defaults.
                </Paragraph>
                <pre style={{ margin: 0, padding: 12, borderRadius: 8, background: "rgba(2,6,23,0.88)", color: "#dbeafe", overflowX: "auto" }}>
                  {WINDOWS_KERBEROS_SNIPPET}
                </pre>
              </div>
            }
          />

          <Form.Item
            label="krb5.conf"
            name="kerberos_krb5_conf"
            extra="Optional. If set, each playbook run writes this content to a temporary krb5.conf and exports KRB5_CONFIG for the runner process."
          >
            <Input.TextArea
              rows={14}
              spellCheck={false}
              disabled={settingsQuery.isLoading || !kerberosEnabled}
              placeholder={"[libdefaults]\n  default_realm = EXAMPLE.COM\n[realms]\n  EXAMPLE.COM = {\n    kdc = dc01.example.com\n  }"}
            />
          </Form.Item>

          <Form.Item
            label="KRB5CCNAME"
            name="kerberos_ccache_name"
            extra="Optional. Set this if your WinRM Kerberos workflow depends on a specific credential cache path or type."
          >
            <Input
              disabled={settingsQuery.isLoading || !kerberosEnabled}
              placeholder="FILE:/tmp/krb5cc_ansible"
            />
          </Form.Item>

          <Space direction="vertical" size="small" style={{ width: "100%", marginBottom: 12 }}>
            <Text strong>Notes</Text>
            <Text type="secondary">Use FQDNs for Windows hosts when Kerberos/SPN validation matters.</Text>
            <Text type="secondary">If you use password-based managed kinit in Ansible, the connection vars still belong in inventory, not here.</Text>
            <Text type="secondary">If you use an external ticket cache or keytab workflow, point `KRB5CCNAME` at that cache and ensure the runner can access it.</Text>
          </Space>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={saveMutation.isPending || settingsQuery.isLoading}
            >
              Save
            </Button>
          </div>
        </Form>
      </Card>
      <Card style={{ maxWidth: 960, marginTop: 16 }}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <div>
            <Title level={5} style={{ margin: 0 }}>SSH Known Hosts</Title>
            <Text type="secondary">
              TOFU is enabled for Ansible targets and SSH Git remotes. Clear cache entries from the Hosts or Git Repositories pages after a redeploy or host key rotation.
            </Text>
          </div>
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="Ansible cache">
              <CacheSummary
                path={knownHostsQuery.data?.ansible.path}
                lineCount={knownHostsQuery.data?.ansible.line_count}
                sizeBytes={knownHostsQuery.data?.ansible.size_bytes}
                modifiedAt={knownHostsQuery.data?.ansible.modified_at}
              />
            </Descriptions.Item>
            <Descriptions.Item label="Git cache">
              <CacheSummary
                path={knownHostsQuery.data?.git.path}
                lineCount={knownHostsQuery.data?.git.line_count}
                sizeBytes={knownHostsQuery.data?.git.size_bytes}
                modifiedAt={knownHostsQuery.data?.git.modified_at}
              />
            </Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>
    </div>
  );
}

function CacheSummary({
  path,
  lineCount,
  sizeBytes,
  modifiedAt,
}: {
  path?: string;
  lineCount?: number;
  sizeBytes?: number;
  modifiedAt?: string | null;
}) {
  return (
    <Space direction="vertical" size={2}>
      <Text code>{path ?? "-"}</Text>
      <Text type="secondary">
        {lineCount ?? 0} entr{(lineCount ?? 0) === 1 ? "y" : "ies"} • {sizeBytes ?? 0} bytes
      </Text>
      <Text type="secondary">
        {modifiedAt ? `Updated ${new Date(modifiedAt).toLocaleString()}` : "No updates yet"}
      </Text>
    </Space>
  );
}
