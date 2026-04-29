import { AppstoreOutlined } from "@ant-design/icons";
import { Button, Modal, Select, Space, Tag, Typography, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import api from "../../api/client";
import { listRecords } from "../../api/crud";
import CrudPage, { type FormField, type SelectOption } from "../../components/CrudPage";
import { useAuth } from "../../store/AuthContext";
import { buildSortedOptions, filterSelectOption } from "../../utils/selectOptions";
import type { App, Environment, K3sCluster, K3sClusterApp } from "../../types";

const { Text } = Typography;

function K3sClustersPageInner({
  appOptions,
  clusterApps,
  envOptions,
}: {
  appOptions: SelectOption[];
  clusterApps: K3sClusterApp[];
  envOptions: SelectOption[];
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [appsCluster, setAppsCluster] = useState<K3sCluster | null>(null);

  const appNameById = useMemo(
    () => new Map(appOptions.map((option) => [Number(option.value), String(option.label)])),
    [appOptions]
  );

  const clusterAppMap = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const item of clusterApps) {
      if (!map.has(item.cluster_id)) {
        map.set(item.cluster_id, []);
      }
      map.get(item.cluster_id)!.push(item.app_id);
    }
    for (const appIds of map.values()) {
      appIds.sort((a, b) => (appNameById.get(a) ?? String(a)).localeCompare(appNameById.get(b) ?? String(b), undefined, {
        sensitivity: "base",
        numeric: true,
      }));
    }
    return map;
  }, [appNameById, clusterApps]);

  const COLUMNS = [
    { title: "Name", dataIndex: "name", key: "name", width: 200 },
    {
      title: "Environment",
      dataIndex: "environment_id",
      key: "environment_id",
      render: (value: number) => envOptions.find((option) => option.value === value)?.label ?? value,
    },
    {
      title: "Apps",
      key: "apps",
      render: (_value: unknown, record: K3sCluster) => {
        const appIds = clusterAppMap.get(record.id) ?? [];
        if (appIds.length === 0) {
          return <Text type="secondary">None</Text>;
        }
        return (
          <Space size={[4, 4]} wrap>
            {appIds.map((appId) => (
              <Tag key={appId} color="blue">
                {appNameById.get(appId) ?? appId}
              </Tag>
            ))}
          </Space>
        );
      },
    },
  ];

  const FIELDS: FormField[] = [
    { key: "name", label: "Name", type: "text" as const, required: true },
    {
      key: "environment_id",
      label: "Environment",
      type: "select" as const,
      required: true,
      options: envOptions,
      quickCreate: {
        endpoint: "/environments",
        queryKey: "/environments",
        title: "Create Environment",
        fields: [{ key: "name", label: "Name", type: "text" as const, required: true }],
      },
    },
  ];

  return (
    <>
      <CrudPage<K3sCluster>
        title="K3s Clusters"
        endpoint="/k3s-clusters"
        columns={COLUMNS}
        formFields={FIELDS}
        extraActions={(record) => (
          <Button
            size="small"
            icon={<AppstoreOutlined />}
            onClick={() => setAppsCluster(record)}
          >
            Apps
          </Button>
        )}
      />
      {appsCluster && (
        <ClusterAppsModal
          appOptions={appOptions}
          cluster={appsCluster}
          clusterAppIds={clusterAppMap.get(appsCluster.id) ?? []}
          isAdmin={isAdmin}
          onClose={() => setAppsCluster(null)}
        />
      )}
    </>
  );
}

function ClusterAppsModal({
  appOptions,
  cluster,
  clusterAppIds,
  isAdmin,
  onClose,
}: {
  appOptions: SelectOption[];
  cluster: K3sCluster;
  clusterAppIds: number[];
  isAdmin: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selectedAppId, setSelectedAppId] = useState<number | undefined>(undefined);

  const assignedOptions = useMemo(
    () => appOptions.filter((option) => clusterAppIds.includes(Number(option.value))),
    [appOptions, clusterAppIds]
  );
  const availableOptions = useMemo(
    () => appOptions.filter((option) => !clusterAppIds.includes(Number(option.value))),
    [appOptions, clusterAppIds]
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/k3s-cluster-apps"] });
  };

  const addMutation = useMutation({
    mutationFn: (appId: number) => api.post("/k3s-cluster-apps", { cluster_id: cluster.id, app_id: appId }),
    onSuccess: () => {
      invalidate();
      setSelectedAppId(undefined);
      message.success("App added to cluster");
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail ?? "Failed to add app");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (appId: number) => api.delete("/k3s-cluster-apps", { params: { cluster_id: cluster.id, app_id: appId } }),
    onSuccess: () => {
      invalidate();
      message.success("App removed from cluster");
    },
    onError: () => {
      message.error("Failed to remove app");
    },
  });

  return (
    <Modal
      title={`Cluster Apps · ${cluster.name}`}
      open
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <Space direction="vertical" size={16} style={{ width: "100%", marginTop: 8 }}>
        <div>
          <Text type="secondary">Assigned Apps</Text>
          <div style={{ marginTop: 10 }}>
            {assignedOptions.length > 0 ? (
              <Space size={[6, 6]} wrap>
                {assignedOptions.map((option) => (
                  <Tag
                    key={option.value}
                    color="blue"
                    closable={isAdmin}
                    onClose={(event) => {
                      event.preventDefault();
                      removeMutation.mutate(Number(option.value));
                    }}
                  >
                    {option.label}
                  </Tag>
                ))}
              </Space>
            ) : (
              <Text type="secondary">No apps assigned to this cluster.</Text>
            )}
          </div>
        </div>

        {isAdmin && (
          <Space.Compact style={{ width: "100%" }}>
            <Select
              style={{ width: "100%" }}
              value={selectedAppId}
              options={availableOptions}
              placeholder="Add app to cluster"
              showSearch
              filterOption={filterSelectOption}
              onChange={(value) => setSelectedAppId(value)}
            />
            <Button
              type="primary"
              disabled={!selectedAppId}
              loading={addMutation.isPending}
              onClick={() => {
                if (selectedAppId) {
                  addMutation.mutate(selectedAppId);
                }
              }}
            >
              Add
            </Button>
          </Space.Compact>
        )}
      </Space>
    </Modal>
  );
}

export default function K3sClustersPage() {
  const { data: envData } = useQuery({
    queryKey: ["/environments"],
    queryFn: () => listRecords<Environment>("/environments", 0, 500),
  });
  const { data: appData } = useQuery({
    queryKey: ["/apps"],
    queryFn: () => listRecords<App>("/apps", 0, 500),
  });
  const { data: clusterApps = [] } = useQuery({
    queryKey: ["/k3s-cluster-apps"],
    queryFn: () => api.get<K3sClusterApp[]>("/k3s-cluster-apps").then((response) => response.data),
  });

  const envOptions = buildSortedOptions(envData?.items ?? [], (environment) => ({ value: environment.id, label: environment.name }));
  const appOptions = buildSortedOptions(appData?.items ?? [], (app) => ({ value: app.id, label: app.name }));

  return <K3sClustersPageInner appOptions={appOptions} clusterApps={clusterApps} envOptions={envOptions} />;
}
