import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import PrivateRoute from "./components/PrivateRoute";
import Layout from "./components/Layout";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const HomeDashboardPage = lazy(() => import("./pages/HomeDashboardPage"));
const InventoryExplorerPage = lazy(() => import("./pages/InventoryExplorerPage"));
const InventoryHierarchyPage = lazy(() => import("./pages/InventoryHierarchyPage"));
const InventoryOverviewPage = lazy(() => import("./pages/InventoryOverviewPage"));
const MonitoringPage = lazy(() => import("./pages/MonitoringPage"));
const AssistantPage = lazy(() => import("./pages/AssistantPage"));
const EnvironmentsPage = lazy(() => import("./pages/tables/EnvironmentsPage"));
const HostTypesPage = lazy(() => import("./pages/tables/HostTypesPage"));
const HostStatusesPage = lazy(() => import("./pages/tables/HostStatusesPage"));
const VlansPage = lazy(() => import("./pages/tables/VlansPage"));
const RolesPage = lazy(() => import("./pages/tables/RolesPage"));
const RoleMatrixPage = lazy(() => import("./pages/RoleMatrixPage"));
const AppsPage = lazy(() => import("./pages/tables/AppsPage"));
const DatastoresPage = lazy(() => import("./pages/tables/DatastoresPage"));
const DomainsPage = lazy(() => import("./pages/tables/DomainsPage"));
const K3sClustersPage = lazy(() => import("./pages/tables/K3sClustersPage"));
const HostsPage = lazy(() => import("./pages/tables/HostsPage"));
const HostResourcesPage = lazy(() => import("./pages/tables/HostResourcesPage"));
const HostStoragePage = lazy(() => import("./pages/tables/HostStoragePage"));
const HostAppsPage = lazy(() => import("./pages/tables/HostAppsPage"));
const UsersPage = lazy(() => import("./pages/tables/UsersPage"));
const ProxmoxPage = lazy(() => import("./pages/ProxmoxPage"));
const UnifiPage = lazy(() => import("./pages/UnifiPage"));
const BackupPage = lazy(() => import("./pages/BackupPage"));
const AnsibleDefaultsPage = lazy(() => import("./pages/tables/AnsibleDefaultsPage"));
const GitReposPage = lazy(() => import("./pages/GitReposPage"));
const GitCredentialsPage = lazy(() => import("./pages/GitCredentialsPage"));
const PlaybookRunsPage = lazy(() => import("./pages/PlaybookRunsPage"));
const JobTemplatesPage = lazy(() => import("./pages/JobTemplatesPage"));
const VaultCredentialsPage = lazy(() => import("./pages/VaultCredentialsPage"));
const BitwardenSettingsPage = lazy(() => import("./pages/admin/BitwardenSettingsPage"));
const MonitoringSettingsPage = lazy(() => import("./pages/admin/MonitoringSettingsPage"));
const GlobalDefaultRolesPage = lazy(() => import("./pages/admin/GlobalDefaultRolesPage"));
const AiSettingsPage = lazy(() => import("./pages/admin/AiSettingsPage"));
const InventoryApiKeysPage = lazy(() => import("./pages/admin/InventoryApiKeysPage"));
const AnsibleRunnerSettingsPage = lazy(() => import("./pages/admin/AnsibleRunnerSettingsPage"));

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route index element={<HomeDashboardPage />} />
            <Route
              path="assistant"
              element={
                <PrivateRoute adminOnly>
                  <AssistantPage />
                </PrivateRoute>
              }
            />
            <Route path="monitoring" element={<MonitoringPage initialView="overview" />} />
            <Route path="monitoring/alerts" element={<MonitoringPage initialView="alerts" />} />
            <Route path="monitoring/capacity" element={<MonitoringPage initialView="capacity" />} />
            <Route path="monitoring/hosts" element={<MonitoringPage initialView="hosts" />} />
            <Route path="monitoring/services" element={<MonitoringPage initialView="services" />} />
            <Route path="monitoring/logs" element={<MonitoringPage initialView="logs" />} />
            <Route path="inventory/overview" element={<InventoryOverviewPage />} />
            <Route path="inventory/explorer" element={<InventoryExplorerPage />} />
            <Route path="inventory/hierarchy" element={<InventoryHierarchyPage />} />
            <Route path="inventory/environments" element={<EnvironmentsPage />} />
            <Route path="inventory/host-types" element={<HostTypesPage />} />
            <Route path="inventory/host-statuses" element={<HostStatusesPage />} />
            <Route path="networking/vlans" element={<VlansPage />} />
            <Route path="inventory/roles" element={<RolesPage />} />
            <Route path="inventory/role-matrix" element={<RoleMatrixPage />} />
            <Route path="inventory/apps" element={<Navigate to="/apps/catalog" replace />} />
            <Route path="apps/catalog" element={<AppsPage />} />
            <Route path="inventory/datastores" element={<DatastoresPage />} />
            <Route path="networking/domains" element={<DomainsPage />} />
            <Route path="inventory/k3s-clusters" element={<K3sClustersPage />} />
            <Route path="inventory/hosts" element={<HostsPage />} />
            <Route path="inventory/host-resources" element={<HostResourcesPage />} />
            <Route path="inventory/host-storage" element={<HostStoragePage />} />
            <Route path="apps/host-apps" element={<HostAppsPage />} />
            <Route path="inventory/hypervisors/proxmox" element={<ProxmoxPage />} />
            <Route
              path="networking/unifi"
              element={
                <PrivateRoute adminOnly>
                  <UnifiPage />
                </PrivateRoute>
              }
            />
            <Route path="inventory/users" element={<UsersPage />} />
            <Route path="automation/ansible-defaults" element={<AnsibleDefaultsPage />} />
            <Route path="inventory/host-apps" element={<Navigate to="/apps/host-apps" replace />} />
            <Route path="inventory/ansible-defaults" element={<Navigate to="/automation/ansible-defaults" replace />} />
            <Route path="automation/git-repos" element={<GitReposPage />} />
            <Route path="automation/git-credentials" element={<GitCredentialsPage />} />
            <Route path="automation/job-templates" element={<JobTemplatesPage />} />
            <Route path="automation/playbook-runs" element={<PlaybookRunsPage />} />
            <Route path="automation/vault-credentials" element={<VaultCredentialsPage />} />
            <Route path="admin/backups" element={<BackupPage />} />
            <Route
              path="admin/inventory-api-keys"
              element={
                <PrivateRoute adminOnly>
                  <InventoryApiKeysPage />
                </PrivateRoute>
              }
            />
            <Route
              path="admin/ansible-runner-settings"
              element={
                <PrivateRoute adminOnly>
                  <AnsibleRunnerSettingsPage />
                </PrivateRoute>
              }
            />
            <Route
              path="admin/bitwarden-settings"
              element={
                <PrivateRoute adminOnly>
                  <BitwardenSettingsPage />
                </PrivateRoute>
              }
            />
            <Route
              path="admin/monitoring-settings"
              element={
                <PrivateRoute adminOnly>
                  <MonitoringSettingsPage />
                </PrivateRoute>
              }
            />
            <Route
              path="admin/global-default-roles"
              element={
                <PrivateRoute adminOnly>
                  <GlobalDefaultRolesPage />
                </PrivateRoute>
              }
            />
            <Route
              path="admin/ai-settings"
              element={
                <PrivateRoute adminOnly>
                  <AiSettingsPage />
                </PrivateRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </QueryClientProvider>
  );
}
