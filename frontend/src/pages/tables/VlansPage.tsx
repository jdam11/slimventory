import CrudPage from "../../components/CrudPage";
import type { Vlan } from "../../types";

const COLUMNS = [
  { title: "VLAN ID", dataIndex: "vlan_id", key: "vlan_id", width: 100 },
  { title: "Subnet", dataIndex: "subnet", key: "subnet" },
  { title: "Description", dataIndex: "description", key: "description" },
];

const FIELDS = [
  { key: "vlan_id", label: "VLAN ID", type: "number" as const, required: true, min: 1 },
  { key: "subnet", label: "Subnet", type: "text" as const },
  { key: "description", label: "Description", type: "text" as const },
];

export default function VlansPage() {
  return (
    <CrudPage<Vlan>
      title="VLANs"
      endpoint="/vlans"
      columns={COLUMNS}
      formFields={FIELDS}
    />
  );
}
