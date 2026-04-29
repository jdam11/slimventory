import {
  AppstoreOutlined,
  CloseOutlined,
  ClusterOutlined,
  CloudServerOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  GlobalOutlined,
  KeyOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoonFilled,
  NodeIndexOutlined,
  SafetyCertificateOutlined,
  PartitionOutlined,
  PlayCircleOutlined,
  LineChartOutlined,
  RadarChartOutlined,
  RobotOutlined,
  SyncOutlined,
  SunFilled,
  TagOutlined,
  UnlockOutlined,
  UserOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
  WarningOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import { Avatar, Badge, Button, Drawer, Grid, Layout as AntLayout, Menu, Select, Space, Switch, Tag, Typography, theme as antdTheme, type MenuProps } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { useAuth } from "../store/AuthContext";
import { useTheme } from "../store/ThemeContext";
import { THEME_NAMES, getThemeLabel, getThemeSwatch } from "../theme";
import AssistantPanel from "./AssistantPanel";

const { Sider, Content, Header } = AntLayout;
const { Text } = Typography;
const { useBreakpoint } = Grid;

interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  children?: NavItem[];
}

type MenuItem = Required<MenuProps>["items"][number];

const NAV: NavItem[] = [
  {
    key: "overview",
    label: "Overview",
    icon: <DashboardOutlined />,
    children: [
      { key: "/", label: "Dashboard", icon: <DashboardOutlined /> },
      { key: "/assistant", label: "AI Chat", icon: <RobotOutlined /> },
      { key: "/monitoring", label: "Monitoring Overview", icon: <LineChartOutlined /> },
      { key: "/monitoring/alerts", label: "Alert Center", icon: <WarningOutlined /> },
      { key: "/monitoring/capacity", label: "Capacity", icon: <DatabaseOutlined /> },
      { key: "/monitoring/hosts", label: "Host Health", icon: <CloudServerOutlined /> },
      { key: "/monitoring/services", label: "Service Activity", icon: <ThunderboltOutlined /> },
      { key: "/monitoring/logs", label: "Log Explorer", icon: <UnorderedListOutlined /> },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    icon: <CloudServerOutlined />,
    children: [
      { key: "/inventory/overview", label: "Inventory Overview", icon: <UnorderedListOutlined /> },
      { key: "/inventory/explorer", label: "Inventory Explorer", icon: <RadarChartOutlined /> },
      { key: "/inventory/hierarchy", label: "Inventory Hierarchy", icon: <ClusterOutlined /> },
      {
        key: "inventory-hosts",
        label: "Hosts",
        icon: <CloudServerOutlined />,
        children: [
          { key: "/inventory/hosts", label: "Hosts", icon: <CloudServerOutlined /> },
          { key: "/inventory/host-resources", label: "Resources", icon: <ClusterOutlined /> },
          { key: "/inventory/host-storage", label: "Storage", icon: <DatabaseOutlined /> },
          { key: "/inventory/host-types", label: "Host Types", icon: <TagOutlined /> },
          { key: "/inventory/host-statuses", label: "Host Statuses", icon: <TagOutlined /> },
        ],
      },
      {
        key: "inventory-hypervisors",
        label: "Hypervisors",
        icon: <SyncOutlined />,
        children: [
          { key: "/inventory/hypervisors/proxmox", label: "Proxmox", icon: <SyncOutlined /> },
        ],
      },
      { key: "/inventory/environments", label: "Environments", icon: <DeploymentUnitOutlined /> },
      { key: "/inventory/roles", label: "Roles", icon: <PartitionOutlined /> },
      { key: "/inventory/role-matrix", label: "Role Matrix", icon: <PartitionOutlined /> },
      { key: "/inventory/datastores", label: "Datastores", icon: <DatabaseOutlined /> },
      { key: "/inventory/k3s-clusters", label: "K3s Clusters", icon: <NodeIndexOutlined /> },
    ],
  },
  {
    key: "apps",
    label: "Apps",
    icon: <AppstoreOutlined />,
    children: [
      { key: "/apps/catalog", label: "Apps", icon: <AppstoreOutlined /> },
      { key: "/apps/host-apps", label: "Host Apps", icon: <CloudServerOutlined /> },
    ],
  },
  {
    key: "networking",
    label: "Networking",
    icon: <WifiOutlined />,
    children: [
      { key: "/networking/vlans", label: "VLANs", icon: <WifiOutlined /> },
      { key: "/networking/domains", label: "Domains", icon: <GlobalOutlined /> },
      { key: "/networking/unifi", label: "UniFi", icon: <WifiOutlined /> },
    ],
  },
  {
    key: "automation",
    label: "Automation",
    icon: <ThunderboltOutlined />,
    children: [
      { key: "/automation/git-repos", label: "Git Repos", icon: <ThunderboltOutlined /> },
      { key: "/automation/git-credentials", label: "Git Credentials", icon: <KeyOutlined /> },
      { key: "/automation/job-templates", label: "Job Templates", icon: <PlayCircleOutlined /> },
      { key: "/automation/playbook-runs", label: "Automation Runs", icon: <PlayCircleOutlined /> },
      { key: "/automation/ansible-defaults", label: "Ansible Defaults", icon: <CodeOutlined /> },
      { key: "/automation/vault-credentials", label: "Vault Credentials", icon: <UnlockOutlined /> },
    ],
  },
  {
      key: "admin",
      label: "Admin",
      icon: <UserOutlined />,
      children: [
        { key: "/inventory/users", label: "Users", icon: <UserOutlined /> },
        { key: "/admin/backups", label: "Backups", icon: <SaveOutlined /> },
        { key: "/admin/inventory-api-keys", label: "Inventory API Keys", icon: <KeyOutlined /> },
        { key: "/admin/ansible-runner-settings", label: "Ansible Runner Settings", icon: <SafetyCertificateOutlined /> },
        { key: "/admin/ai-settings", label: "AI Settings", icon: <RobotOutlined /> },
        { key: "/admin/bitwarden-settings", label: "Bitwarden Settings", icon: <UnlockOutlined /> },
        { key: "/admin/monitoring-settings", label: "Monitoring Settings", icon: <LineChartOutlined /> },
        { key: "/admin/global-default-roles", label: "Global Default Roles", icon: <PartitionOutlined /> },
      ],
    },
];

function shouldShowNavItem(item: NavItem, userRole?: string): boolean {
  if (item.key === "/assistant" || item.key === "/inventory/users" || item.key === "admin") {
    return userRole === "admin";
  }
  if (item.key === "/networking/unifi") {
    return userRole === "admin";
  }
  return true;
}

function filterNavItems(items: NavItem[], userRole?: string): NavItem[] {
  return items
    .filter((item) => shouldShowNavItem(item, userRole))
    .map((item) => {
      if (!item.children) {
        return item;
      }
      const children = filterNavItems(item.children, userRole);
      return { ...item, children };
    })
    .filter((item) => !item.children || item.children.length > 0);
}

function findNavAncestors(items: NavItem[], targetKey: string, ancestors: string[] = []): string[] | null {
  for (const item of items) {
    if (item.key === targetKey) {
      return ancestors;
    }
    if (item.children) {
      const result = findNavAncestors(item.children, targetKey, [...ancestors, item.key]);
      if (result) {
        return result;
      }
    }
  }
  return null;
}

function mapNavItem(item: NavItem): MenuItem {
  return {
    key: item.key,
    label: item.label,
    icon: item.icon,
    children: item.children?.map(mapNavItem),
  };
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { mode, themeName, toggleTheme, setThemeName } = useTheme();
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const selectedMenuKey = pathname;
  const filteredNav = useMemo(() => filterNavItems(NAV, user?.role), [user?.role]);

  const menuItems = useMemo(
    () => filteredNav.map(mapNavItem),
    [filteredNav]
  );

  useEffect(() => {
    const ancestors = findNavAncestors(filteredNav, pathname);
    if (ancestors) {
      setOpenKeys(ancestors);
    }
  }, [filteredNav, pathname]);

  const navMenu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selectedMenuKey]}
      openKeys={openKeys}
      onOpenChange={(keys) => setOpenKeys(keys as string[])}
      items={menuItems}
      onClick={({ key }) => {
        navigate(String(key));
        setDrawerOpen(false);
      }}
    />
  );

  return (
    <AntLayout style={{ minHeight: "100vh", background: token.colorBgLayout }}>
      {/* Sidebar — desktop only */}
      {!isMobile && (
        <Sider
          theme="dark"
          width={248}
          collapsible
          collapsed={sidebarCollapsed}
          onCollapse={(value) => setSidebarCollapsed(value)}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <div style={{ padding: "16px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            {sidebarCollapsed ? (
              <img src="/icon.svg" style={{ width: 28, height: 28, flexShrink: 0 }} alt="SLIM icon" />
            ) : (
              <img src="/logo.svg" style={{ height: 32, width: "auto", maxWidth: "100%" }} alt="SLIM logo" />
            )}
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {navMenu}
          </div>
          <div style={{ padding: "12px 16px", color: "rgba(255,255,255,0.45)", fontSize: 12, textAlign: "center", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            v1.0.0
          </div>
        </Sider>
      )}

      {/* Mobile nav drawer */}
      {isMobile && (
        <Drawer
          title={
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src="/icon.svg" style={{ width: 24, height: 24, flexShrink: 0 }} alt="SLIM icon" />
              <img src="/logo.svg" style={{ height: 22, width: "auto" }} alt="SLIM logo" />
            </div>
          }
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          styles={{ body: { padding: 0, background: "#001529" }, header: { background: "#001529", color: "#fff" } }}
          width={240}
          closeIcon={<span style={{ color: "#fff" }}>✕</span>}
        >
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: 1 }}>
              {navMenu}
            </div>
            <div style={{ padding: "12px 16px", color: "rgba(255,255,255,0.45)", fontSize: 12, textAlign: "center", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
              v1.0.0
            </div>
          </div>
        </Drawer>
      )}

      <AntLayout style={{ background: token.colorBgLayout }}>
        <Header
          style={{
            background: token.colorBgContainer,
            padding: isMobile ? "0 12px" : "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {/* Left: hamburger (mobile) or spacer (desktop) */}
          {isMobile ? (
            <MenuOutlined
              style={{ fontSize: 18, cursor: "pointer", color: token.colorText }}
              onClick={() => setDrawerOpen(true)}
            />
          ) : (
            <span />
          )}

          {/* Right: controls */}
          <Space size={isMobile ? 8 : 12}>
            {!isMobile && (
              <Select
                value={themeName}
                onChange={setThemeName}
                style={{ width: 140 }}
                aria-label="Select theme"
                options={THEME_NAMES.map((key) => ({
                  value: key,
                  label: (
                    <Space size={6}>
                      <span
                        style={{
                          display: "inline-block",
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          background: getThemeSwatch(key),
                          border: "1px solid rgba(128,128,128,0.3)",
                          verticalAlign: "middle",
                        }}
                      />
                      {getThemeLabel(key)}
                    </Space>
                  ),
                }))}
              />
            )}
            <Switch
              checked={mode === "dark"}
              onChange={toggleTheme}
              checkedChildren={<MoonFilled />}
              unCheckedChildren={<SunFilled />}
              aria-label="Toggle theme"
            />
            <Avatar icon={<UserOutlined />} size="small" />
            {!isMobile && <Text strong>{user?.username}</Text>}
            {!isMobile && <Tag color={user?.role === "admin" ? "gold" : "default"}>{user?.role}</Tag>}
            <LogoutOutlined
              style={{ cursor: "pointer", color: token.colorTextSecondary }}
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            />
          </Space>
        </Header>

        <Content style={{ margin: isMobile ? 12 : 24 }}>
          <Outlet />
        </Content>
      </AntLayout>

      {user?.role === "admin" && (
        <>
          {assistantOpen && (
            <div
              style={{
                position: "fixed",
                right: isMobile ? 0 : 24,
                bottom: isMobile ? 0 : 80,
                width: isMobile ? "100vw" : 380,
                height: isMobile ? "70vh" : 520,
                zIndex: 1050,
                display: "flex",
                flexDirection: "column",
                borderRadius: isMobile ? "16px 16px 0 0" : 12,
                overflow: "hidden",
                boxShadow: token.boxShadowSecondary,
                background: token.colorBgElevated,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgElevated,
                  flexShrink: 0,
                }}
              >
                <Space size={8}>
                  <RobotOutlined />
                  <span style={{ fontWeight: 600 }}>SLIM</span>
                </Space>
                <Space size={4}>
                  <Button
                    size="small"
                    type="text"
                    onClick={() => { setAssistantOpen(false); navigate("/assistant"); }}
                  >
                    Full page
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    icon={<CloseOutlined />}
                    onClick={() => setAssistantOpen(false)}
                  />
                </Space>
              </div>
              <div style={{ flex: 1, overflow: "hidden", padding: 12 }}>
                <AssistantPanel embedded mode="popup" pageContext={{ route: pathname }} />
              </div>
            </div>
          )}

          <div
            style={{
              position: "fixed",
              right: isMobile ? 12 : 24,
              bottom: isMobile ? 12 : 24,
              zIndex: 1100,
            }}
          >
            <Badge dot={assistantOpen} offset={[-6, 6]}>
              <Button
                type="primary"
                shape={isMobile ? "circle" : "round"}
                size="large"
                icon={<RobotOutlined />}
                onClick={() => setAssistantOpen((open) => !open)}
                style={{ boxShadow: token.boxShadowSecondary }}
              >
                {!isMobile ? "SLIM" : null}
              </Button>
            </Badge>
          </div>
        </>
      )}
    </AntLayout>
  );
}
