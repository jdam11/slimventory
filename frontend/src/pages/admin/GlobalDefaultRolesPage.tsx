/**
 * GlobalDefaultRolesPage — admin configures the ordered list of baseline roles
 * that apply to all hosts in the Ansible inventory.
 */
import { useEffect, useState } from "react";
import { Button, Card, Space, Spin, Typography, message } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import { listRecords } from "../../api/crud";
import SortableRoleSelect from "../../components/SortableRoleSelect";
import type { GlobalDefaultRole, Role } from "../../types";

const { Title, Paragraph } = Typography;

export default function GlobalDefaultRolesPage() {
  const qc = useQueryClient();
  const [roleIds, setRoleIds] = useState<number[]>([]);

  const { data: rolesData } = useQuery({
    queryKey: ["/roles"],
    queryFn: () => listRecords<Role>("/roles", 0, 500),
  });
  const roleOpts = (rolesData?.items ?? []).map((r) => ({
    value: r.id,
    label: r.name,
  }));

  const { data: defaults, isLoading } = useQuery({
    queryKey: ["/global-default-roles"],
    queryFn: () =>
      api.get<GlobalDefaultRole[]>("/global-default-roles").then((r) => r.data),
  });

  useEffect(() => {
    if (defaults) {
      const sorted = [...defaults].sort((a, b) => a.priority - b.priority);
      setRoleIds(sorted.map((d) => d.role_id));
    }
  }, [defaults]);

  const saveMut = useMutation({
    mutationFn: (ids: number[]) =>
      api.put<GlobalDefaultRole[]>(
        "/global-default-roles",
        ids.map((role_id, i) => ({ role_id, priority: i + 1 }))
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/global-default-roles"] });
      message.success("Global default roles saved.");
    },
    onError: () => message.error("Failed to save global default roles."),
  });

  return (
    <div style={{ maxWidth: 600 }}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Global Default Roles
          </Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            These roles apply to all hosts as a baseline in the Ansible
            inventory. Roles higher in the list have higher variable precedence.
            Host-type roles and host-specific roles will override these.
          </Paragraph>
        </div>

        {isLoading ? (
          <Spin />
        ) : (
          <Card size="small">
            <SortableRoleSelect
              value={roleIds}
              onChange={setRoleIds}
              options={roleOpts}
            />
          </Card>
        )}

        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saveMut.isPending}
          onClick={() => saveMut.mutate(roleIds)}
        >
          Save
        </Button>
      </Space>
    </div>
  );
}
