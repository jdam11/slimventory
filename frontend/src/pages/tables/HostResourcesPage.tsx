import { useQuery } from "@tanstack/react-query";
import CrudPage from "../../components/CrudPage";
import { listRecords } from "../../api/crud";
import { buildHostQuickCreateConfig } from "./hostQuickCreate";
import { buildHostOption, buildSortedOptions, buildVlanOption } from "../../utils/selectOptions";
import type {
  Domain,
  Environment,
  HostResource,
  Host,
  HostType,
  K3sCluster,
  Role,
  Vlan,
} from "../../types";

export default function HostResourcesPage() {
  const { data: hostData } = useQuery({
    queryKey: ["/hosts"],
    queryFn: () => listRecords<Host>("/hosts", 0, 500),
  });
  const { data: envData } = useQuery({ queryKey: ["/environments"], queryFn: () => listRecords<Environment>("/environments", 0, 500) });
  const { data: hostTypeData } = useQuery({ queryKey: ["/host-types"], queryFn: () => listRecords<HostType>("/host-types", 0, 500) });
  const { data: vlanData } = useQuery({ queryKey: ["/vlans"], queryFn: () => listRecords<Vlan>("/vlans", 0, 500) });
  const { data: roleData } = useQuery({ queryKey: ["/roles"], queryFn: () => listRecords<Role>("/roles", 0, 500) });
  const { data: clusterData } = useQuery({ queryKey: ["/k3s-clusters"], queryFn: () => listRecords<K3sCluster>("/k3s-clusters", 0, 500) });
  const { data: domainData } = useQuery({ queryKey: ["/domains"], queryFn: () => listRecords<Domain>("/domains", 0, 500) });

  const hostOpts = buildSortedOptions(hostData?.items ?? [], buildHostOption);
  const envOpts = buildSortedOptions(envData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const hostTypeOpts = buildSortedOptions(hostTypeData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const vlanOpts = buildSortedOptions(vlanData?.items ?? [], buildVlanOption);
  const roleOpts = buildSortedOptions(roleData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const clusterOpts = buildSortedOptions(clusterData?.items ?? [], (e) => ({ value: e.id, label: e.name }));
  const domainOpts = buildSortedOptions(domainData?.items ?? [], (e) => ({ value: e.id, label: e.fqdn }));

  const name = (v: number) => hostOpts.find((o) => o.value === v)?.label ?? v;

  const COLUMNS = [
    { title: "Host", dataIndex: "host_id", key: "host", width: 200, render: (v: number) => name(v) },
    { title: "CPU Sockets", dataIndex: "cpu_sockets", key: "cpu_sockets", width: 110 },
    { title: "CPU Cores", dataIndex: "cpu_cores", key: "cpu_cores", width: 100 },
    { title: "RAM (MB)", dataIndex: "ram_mb", key: "ram_mb", width: 100 },
  ];

  const FIELDS = [
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
    { key: "cpu_sockets", label: "CPU Sockets", type: "number" as const, required: true, min: 1 },
    { key: "cpu_cores", label: "CPU Cores", type: "number" as const, required: true, min: 1 },
    { key: "ram_mb", label: "RAM (MB)", type: "number" as const, required: true, min: 1 },
  ];

  return (
    <CrudPage<HostResource>
      title="Host Resources"
      endpoint="/host-resources"
      columns={COLUMNS}
      formFields={FIELDS}
    />
  );
}
