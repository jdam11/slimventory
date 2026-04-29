import { useQuery } from "@tanstack/react-query";
import CrudPage, { type FormField } from "../../components/CrudPage";
import { listRecords } from "../../api/crud";
import { buildHostQuickCreateConfig } from "./hostQuickCreate";
import { buildHostOption, buildSortedOptions, buildVlanOption } from "../../utils/selectOptions";
import type {
  Datastore,
  Domain,
  Environment,
  HostStorage,
  Host,
  HostType,
  K3sCluster,
  Role,
  Vlan,
} from "../../types";

export default function HostStoragePage() {
  const { data: hostData } = useQuery({ queryKey: ["/hosts"], queryFn: () => listRecords<Host>("/hosts", 0, 500) });
  const { data: dsData } = useQuery({ queryKey: ["/datastores"], queryFn: () => listRecords<Datastore>("/datastores", 0, 500) });
  const { data: envData } = useQuery({ queryKey: ["/environments"], queryFn: () => listRecords<Environment>("/environments", 0, 500) });
  const { data: hostTypeData } = useQuery({ queryKey: ["/host-types"], queryFn: () => listRecords<HostType>("/host-types", 0, 500) });
  const { data: vlanData } = useQuery({ queryKey: ["/vlans"], queryFn: () => listRecords<Vlan>("/vlans", 0, 500) });
  const { data: roleData } = useQuery({ queryKey: ["/roles"], queryFn: () => listRecords<Role>("/roles", 0, 500) });
  const { data: clusterData } = useQuery({ queryKey: ["/k3s-clusters"], queryFn: () => listRecords<K3sCluster>("/k3s-clusters", 0, 500) });
  const { data: domainData } = useQuery({ queryKey: ["/domains"], queryFn: () => listRecords<Domain>("/domains", 0, 500) });

  const hostOpts = buildSortedOptions(hostData?.items ?? [], buildHostOption);
  const dsOpts = buildSortedOptions(dsData?.items ?? [], (d) => ({ value: d.id, label: d.name }));
  const envOpts = buildSortedOptions(envData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const hostTypeOpts = buildSortedOptions(hostTypeData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const vlanOpts = buildSortedOptions(vlanData?.items ?? [], buildVlanOption);
  const roleOpts = buildSortedOptions(roleData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const clusterOpts = buildSortedOptions(clusterData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const domainOpts = buildSortedOptions(domainData?.items ?? [], (e) => ({ value: e.id, label: e.fqdn }));

  const hostName = (v: number) => hostOpts.find((o) => o.value === v)?.label ?? v;
  const dsName = (v: number) => dsOpts.find((o) => o.value === v)?.label ?? v;

  const COLUMNS = [
    { title: "Host", dataIndex: "host_id", key: "host", width: 180, render: (v: number) => hostName(v) },
    { title: "Purpose", dataIndex: "purpose", key: "purpose", width: 100 },
    { title: "Datastore", dataIndex: "datastore_id", key: "ds", width: 150, render: (v: number) => dsName(v) },
    { title: "Size (GB)", dataIndex: "size_gb", key: "size_gb", width: 100 },
  ];

  const FIELDS: FormField[] = [
    {
      key: "host_id",
      label: "Host",
      type: "select" as const,
      required: true,
      options: hostOpts,
      quickCreate: buildHostQuickCreateConfig({
        envOpts,
        hostTypeOpts,
        vlanOpts,
        roleOpts,
        clusterOpts,
        hostOpts,
        domainOpts,
      }),
    },
    { key: "purpose", label: "Purpose (e.g. os, hdd01)", type: "text" as const, required: true },
    {
      key: "datastore_id",
      label: "Datastore",
      type: "select" as const,
      required: true,
      options: dsOpts,
      quickCreate: {
        endpoint: "/datastores",
        queryKey: "/datastores",
        title: "Create Datastore",
        fields: [
          { key: "name", label: "Name", type: "text" as const, required: true },
          { key: "description", label: "Description", type: "text" as const },
        ],
      },
    },
    { key: "size_gb", label: "Size (GB)", type: "number" as const, required: true, min: 1 },
  ];

  return (
    <CrudPage<HostStorage>
      title="Host Storage"
      endpoint="/host-storage"
      columns={COLUMNS}
      formFields={FIELDS}
    />
  );
}
