import type { DataNode } from "antd/es/tree";

export interface InventoryHierarchyHost {
  key: string;
  name: string;
  vars: Record<string, unknown>;
  inventoryId: number | null;
  parentGroupPath: string[];
}

export interface InventoryHierarchyGroup {
  key: string;
  name: string;
  vars: Record<string, unknown>;
  hosts: InventoryHierarchyHost[];
  children: InventoryHierarchyGroup[];
  path: string[];
}

export type InventoryHierarchySelectedNode =
  | { type: "group"; group: InventoryHierarchyGroup }
  | { type: "host"; host: InventoryHierarchyHost }
  | null;

export interface InventoryHierarchyHostRow {
  key: string;
  selectionKey: string;
  name: string;
  groupPath: string;
  inventoryId: number | null;
  vars: Record<string, unknown>;
}

export interface InventoryHierarchyStats {
  groups: number;
  directHosts: number;
  totalHosts: number;
}

type InventoryHostVarsMap = Record<string, Record<string, unknown>>;

interface RawInventoryGroup {
  vars?: Record<string, unknown>;
  hosts?: string[] | Record<string, unknown>;
  children?: string[] | Record<string, unknown>;
}

interface RawInventoryDocument {
  _meta?: {
    hostvars?: InventoryHostVarsMap;
  };
  [key: string]: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeGroup(raw: unknown): RawInventoryGroup {
  if (!isObject(raw)) return {};
  return {
    vars: isObject(raw.vars) ? raw.vars : {},
    hosts: Array.isArray(raw.hosts) || isObject(raw.hosts) ? raw.hosts : {},
    children: Array.isArray(raw.children) || isObject(raw.children) ? raw.children : {},
  };
}

function hostFromName(name: string, hostvars: InventoryHostVarsMap, parentGroupPath: string[]): InventoryHierarchyHost {
  const vars = isObject(hostvars[name]) ? hostvars[name] : {};
  return {
    key: `host:${[...parentGroupPath, name].join("/")}`,
    name,
    vars,
    inventoryId: typeof vars.inventory_id === "number" ? vars.inventory_id : Number(vars.inventory_id ?? "") || null,
    parentGroupPath,
  };
}

export function parseInventoryHierarchy(input: unknown): InventoryHierarchyGroup | null {
  const doc = isObject(input) ? (input as RawInventoryDocument) : null;
  if (!doc) return null;

  const hostvars = isObject(doc._meta?.hostvars) ? doc._meta?.hostvars as InventoryHostVarsMap : {};
  const rootName = "all" in doc ? "all" : Object.keys(doc).find((key) => key !== "_meta");
  if (!rootName) return null;

  const walk = (name: string, raw: unknown, parentPath: string[], seen: Set<string>): InventoryHierarchyGroup => {
    const normalized = normalizeGroup(raw);
    const path = [...parentPath, name];
    const identity = path.join("/");
    if (seen.has(identity)) {
      return { key: `group:${identity}`, name, vars: normalized.vars ?? {}, hosts: [], children: [], path };
    }

    const nextSeen = new Set(seen);
    nextSeen.add(identity);

    const rawHosts = normalized.hosts ?? {};
    const rawChildren = normalized.children ?? {};

    let hosts: InventoryHierarchyHost[] = [];
    if (Array.isArray(rawHosts)) {
      hosts = rawHosts.map((hostName) => hostFromName(String(hostName), hostvars, path));
    } else if (isObject(rawHosts)) {
      hosts = Object.entries(rawHosts).map(([hostName, hostValue]) => {
        const mergedVars = {
          ...(isObject(hostvars[hostName]) ? hostvars[hostName] : {}),
          ...(isObject(hostValue) ? hostValue : {}),
        };
        return {
          key: `host:${[...path, hostName].join("/")}`,
          name: hostName,
          vars: mergedVars,
          inventoryId: typeof mergedVars.inventory_id === "number" ? mergedVars.inventory_id : Number(mergedVars.inventory_id ?? "") || null,
          parentGroupPath: path,
        };
      });
    }

    const shouldHideRootHosts = name === "all" && Array.isArray(rawChildren) && rawChildren.length > 0;
    if (shouldHideRootHosts) {
      hosts = [];
    }

    let children: InventoryHierarchyGroup[] = [];
    if (Array.isArray(rawChildren)) {
      children = rawChildren.map((childName) => {
        const childKey = String(childName);
        return walk(childKey, doc[childKey], path, nextSeen);
      });
    } else if (isObject(rawChildren)) {
      children = Object.entries(rawChildren).map(([childName, childValue]) => walk(childName, childValue, path, nextSeen));
    }

    return {
      key: `group:${identity}`,
      name,
      vars: normalized.vars ?? {},
      hosts,
      children,
      path,
    };
  };

  return walk(rootName, doc[rootName], [], new Set<string>());
}

function hostMatches(host: InventoryHierarchyHost, query: string): boolean {
  if (!query) return true;
  if (host.name.toLowerCase().includes(query)) return true;
  if (Object.keys(host.vars).some((key) => key.toLowerCase().includes(query))) return true;
  return Object.values(host.vars).some((value) => String(value).toLowerCase().includes(query));
}

function groupMatches(group: InventoryHierarchyGroup, query: string): boolean {
  if (!query) return true;
  if (group.name.toLowerCase().includes(query)) return true;
  if (Object.keys(group.vars).some((key) => key.toLowerCase().includes(query))) return true;
  if (Object.values(group.vars).some((value) => String(value).toLowerCase().includes(query))) return true;
  if (group.hosts.some((host) => hostMatches(host, query))) return true;
  return group.children.some((child) => groupMatches(child, query));
}

export function buildInventoryTreeData(
  group: InventoryHierarchyGroup,
  query: string,
  renderGroupTitle: (group: InventoryHierarchyGroup) => DataNode["title"],
  renderHostTitle: (host: InventoryHierarchyHost) => DataNode["title"]
): DataNode[] {
  const needle = query.trim().toLowerCase();

  function convert(node: InventoryHierarchyGroup): DataNode | null {
    if (!groupMatches(node, needle)) return null;

    const childGroups = node.children
      .map(convert)
      .filter((item): item is DataNode => Boolean(item));

    const hostChildren: DataNode[] = node.hosts
      .filter((host) => hostMatches(host, needle))
      .map((host) => ({
        key: host.key,
        title: renderHostTitle(host),
        isLeaf: true,
      }));

    return {
      key: node.key,
      title: renderGroupTitle(node),
      children: [...childGroups, ...hostChildren],
    };
  }

  const rootNode = convert(group);
  return rootNode ? [rootNode] : [];
}

export function flattenInventoryHosts(group: InventoryHierarchyGroup): InventoryHierarchyHostRow[] {
  const rows: InventoryHierarchyHostRow[] = [];

  function walk(node: InventoryHierarchyGroup) {
    node.hosts.forEach((host) => {
      rows.push({
        key: host.key,
        selectionKey: host.key,
        name: host.name,
        groupPath: node.path.join(" / "),
        inventoryId: host.inventoryId,
        vars: host.vars,
      });
    });
    node.children.forEach(walk);
  }

  walk(group);
  return rows;
}

export function getInventoryHierarchyStats(group: InventoryHierarchyGroup): InventoryHierarchyStats {
  let groups = 0;
  let totalHosts = 0;

  function walk(node: InventoryHierarchyGroup) {
    groups += 1;
    totalHosts += node.hosts.length;
    node.children.forEach(walk);
  }

  walk(group);

  return {
    groups,
    directHosts: group.hosts.length,
    totalHosts,
  };
}

export function findInventoryNodeByKey(group: InventoryHierarchyGroup, key: string): InventoryHierarchySelectedNode {
  function walk(node: InventoryHierarchyGroup): InventoryHierarchySelectedNode {
    if (node.key === key) {
      return { type: "group", group: node };
    }

    const host = node.hosts.find((item) => item.key === key);
    if (host) {
      return { type: "host", host };
    }

    for (const child of node.children) {
      const result = walk(child);
      if (result) return result;
    }

    return null;
  }

  return walk(group);
}

export function getExpandedGroupKeys(group: InventoryHierarchyGroup): string[] {
  const keys: string[] = [];

  function walk(node: InventoryHierarchyGroup) {
    keys.push(node.key);
    node.children.forEach(walk);
  }

  walk(group);
  return keys;
}

export function findFirstHostKeyByInventoryId(group: InventoryHierarchyGroup, hostId: number): string | null {
  function walk(node: InventoryHierarchyGroup): string | null {
    const host = node.hosts.find((item) => item.inventoryId === hostId);
    if (host) return host.key;
    for (const child of node.children) {
      const result = walk(child);
      if (result) return result;
    }
    return null;
  }

  return walk(group);
}
