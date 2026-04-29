import type { SelectOption } from "../components/CrudPage";

function normalizeText(value: string | number | null | undefined): string {
  return String(value ?? "").trim();
}

export function compareSelectOptions(a: SelectOption, b: SelectOption): number {
  return normalizeText(a.label).localeCompare(normalizeText(b.label), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

export function sortSelectOptions<T extends SelectOption>(options: T[]): T[] {
  return [...options].sort(compareSelectOptions);
}

export function buildSortedOptions<T>(items: T[], mapItem: (item: T) => SelectOption): SelectOption[] {
  return sortSelectOptions(items.map(mapItem));
}

export function filterSelectOption(input: string, option?: SelectOption): boolean {
  const haystack = `${normalizeText(option?.label)} ${normalizeText(option?.searchText)}`.toLowerCase();
  return haystack.includes(input.toLowerCase());
}

export function buildHostOption(host: { id: number; name: string; ipv4?: string | null }): SelectOption {
  return {
    value: host.id,
    label: host.name,
    searchText: [host.name, host.ipv4, host.id].filter(Boolean).join(" "),
  };
}

export function buildVlanOption(vlan: { id: number; vlan_id: number; description?: string | null }): SelectOption {
  return {
    value: vlan.id,
    label: `VLAN ${vlan.vlan_id}${vlan.description ? ` — ${vlan.description}` : ""}`,
    searchText: [vlan.vlan_id, vlan.description].filter(Boolean).join(" "),
  };
}
