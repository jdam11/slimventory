import CrudPage from "../../components/CrudPage";
import type { Environment } from "../../types";

const COLUMNS = [
  { title: "Name", dataIndex: "name", key: "name" },
];

const FIELDS = [
  { key: "name", label: "Name", type: "text" as const, required: true },
];

export default function EnvironmentsPage() {
  return (
    <CrudPage<Environment>
      title="Environments"
      endpoint="/environments"
      columns={COLUMNS}
      formFields={FIELDS}
    />
  );
}
