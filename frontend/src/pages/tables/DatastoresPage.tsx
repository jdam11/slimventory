import CrudPage from "../../components/CrudPage";
import type { Datastore } from "../../types";

const COLUMNS = [
  { title: "Name", dataIndex: "name", key: "name", width: 200 },
  { title: "Description", dataIndex: "description", key: "description" },
];

const FIELDS = [
  { key: "name", label: "Name", type: "text" as const, required: true },
  { key: "description", label: "Description", type: "text" as const },
];

export default function DatastoresPage() {
  return (
    <CrudPage<Datastore>
      title="Datastores"
      endpoint="/datastores"
      columns={COLUMNS}
      formFields={FIELDS}
    />
  );
}
