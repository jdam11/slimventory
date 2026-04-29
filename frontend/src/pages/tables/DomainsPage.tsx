import CrudPage from "../../components/CrudPage";
import type { Domain } from "../../types";

const COLUMNS = [
  { title: "FQDN", dataIndex: "fqdn", key: "fqdn" },
];

const FIELDS = [
  { key: "fqdn", label: "FQDN", type: "text" as const, required: true },
];

export default function DomainsPage() {
  return (
    <CrudPage<Domain>
      title="Domains"
      endpoint="/domains"
      columns={COLUMNS}
      formFields={FIELDS}
    />
  );
}
