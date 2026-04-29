import { useLocation } from "react-router-dom";
import AssistantPanel from "../components/AssistantPanel";

export default function AssistantPage() {
  const location = useLocation();

  return <AssistantPanel pageContext={{ route: location.pathname }} showAdminTabs={false} showSharedEditor />;
}
