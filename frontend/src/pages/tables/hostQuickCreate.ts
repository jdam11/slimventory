import type { FormField, SelectOption } from "../../components/CrudPage";

interface HostQuickCreateOptions {
  envOpts: SelectOption[];
  hostTypeOpts: SelectOption[];
  vlanOpts: SelectOption[];
  roleOpts: SelectOption[];
  clusterOpts: SelectOption[];
  hostOpts: SelectOption[];
  domainOpts: SelectOption[];
}

export function buildHostQuickCreateConfig(opts: HostQuickCreateOptions) {
  const fields: FormField[] = [
    { key: "id", label: "VMID (Proxmox ID)", type: "number", required: true, min: 1, section: "Identity" },
    { key: "name", label: "Name", type: "text", required: true, section: "Identity" },
    {
      key: "ipv4",
      label: "IPv4",
      type: "text",
      required: true,
      placeholder: "10.10.x.x or DHCP",
      section: "Identity",
    },
    { key: "mac", label: "MAC Address", type: "text", section: "Identity" },
    {
      key: "environment_id",
      label: "Environment",
      type: "select",
      required: true,
      options: opts.envOpts,
      section: "Placement",
    },
    {
      key: "host_type_id",
      label: "Host Type",
      type: "select",
      required: true,
      options: opts.hostTypeOpts,
      section: "Placement",
    },
    { key: "vlan_id", label: "VLAN", type: "select", required: true, options: opts.vlanOpts, section: "Placement" },
    { key: "role_id", label: "Role", type: "select", required: true, options: opts.roleOpts, section: "Placement" },
    {
      key: "k3s_cluster_id",
      label: "K3s Cluster",
      type: "select",
      options: opts.clusterOpts,
      section: "Placement",
    },
    {
      key: "proxmox_host_id",
      label: "Proxmox Host",
      type: "select",
      options: opts.hostOpts,
      section: "Routing & Platform",
    },
    {
      key: "domain_internal_id",
      label: "Domain Internal",
      type: "select",
      options: opts.domainOpts,
      section: "Routing & Platform",
    },
    {
      key: "domain_external_id",
      label: "Domain External",
      type: "select",
      options: opts.domainOpts,
      section: "Routing & Platform",
    },
    { key: "notes", label: "Notes", type: "textarea", section: "Notes" },
  ];

  return {
    endpoint: "/hosts",
    queryKey: "/hosts",
    title: "Create Host",
    fields,
  };
}
