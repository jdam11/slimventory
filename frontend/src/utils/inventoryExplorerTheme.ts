interface InventoryExplorerThemeToken {
  colorText: string;
  colorTextSecondary: string;
  colorBorderSecondary: string;
  colorPrimaryBg: string;
  colorPrimaryBorder: string;
  colorSuccessBg: string;
  colorSuccessBorder: string;
  colorWarningBg: string;
  colorWarningBorder: string;
  colorErrorBg: string;
  colorErrorBorder: string;
  colorInfoBg: string;
  colorInfoBorder: string;
}

interface AccentStyle {
  background: string;
  borderColor: string;
  color: string;
}

const FALLBACK_LAYER_STYLE: AccentStyle = {
  background: "var(--ant-color-fill-quaternary)",
  borderColor: "var(--ant-color-border-secondary)",
  color: "var(--ant-color-text-secondary)",
};

function buildAccentStyle(background: string, borderColor: string, color: string): AccentStyle {
  return { background, borderColor, color };
}

export function inventoryExplorerLayerStyles(token: InventoryExplorerThemeToken): Record<string, AccentStyle> {
  return {
    base: buildAccentStyle(token.colorInfoBg, token.colorInfoBorder, token.colorText),
    ansible_defaults: buildAccentStyle(token.colorSuccessBg, token.colorSuccessBorder, token.colorText),
    status_defaults: buildAccentStyle(token.colorWarningBg, token.colorWarningBorder, token.colorText),
    global_role_defaults: buildAccentStyle(token.colorPrimaryBg, token.colorPrimaryBorder, token.colorText),
    host_type_defaults: buildAccentStyle(token.colorInfoBg, token.colorInfoBorder, token.colorText),
    host_type_role_defaults: buildAccentStyle(token.colorInfoBg, token.colorInfoBorder, token.colorText),
    host_role_defaults: buildAccentStyle(token.colorPrimaryBg, token.colorPrimaryBorder, token.colorText),
    app_defaults: buildAccentStyle(token.colorSuccessBg, token.colorSuccessBorder, token.colorText),
    host_type_overrides: buildAccentStyle(token.colorInfoBg, token.colorInfoBorder, token.colorText),
    status_overrides: buildAccentStyle(token.colorWarningBg, token.colorWarningBorder, token.colorText),
    role_overrides: buildAccentStyle(token.colorPrimaryBg, token.colorPrimaryBorder, token.colorText),
    app_overrides: buildAccentStyle(token.colorSuccessBg, token.colorSuccessBorder, token.colorText),
    ansible_overrides: buildAccentStyle(token.colorSuccessBg, token.colorSuccessBorder, token.colorText),
  };
}

export function inventoryExplorerLayerStyle(layerKey: string, token: InventoryExplorerThemeToken): AccentStyle {
  return inventoryExplorerLayerStyles(token)[layerKey] ?? FALLBACK_LAYER_STYLE;
}

export function inventoryExplorerGroupStyle(category: string, token: InventoryExplorerThemeToken): AccentStyle {
  switch (category) {
    case "environment":
      return buildAccentStyle(token.colorInfoBg, token.colorInfoBorder, token.colorText);
    case "role":
      return buildAccentStyle(token.colorPrimaryBg, token.colorPrimaryBorder, token.colorText);
    case "type":
      return buildAccentStyle(token.colorInfoBg, token.colorInfoBorder, token.colorText);
    case "vlan":
      return buildAccentStyle(token.colorWarningBg, token.colorWarningBorder, token.colorText);
    case "status":
      return buildAccentStyle(token.colorWarningBg, token.colorWarningBorder, token.colorText);
    case "app":
      return buildAccentStyle(token.colorSuccessBg, token.colorSuccessBorder, token.colorText);
    case "k3s":
      return buildAccentStyle(token.colorPrimaryBg, token.colorPrimaryBorder, token.colorText);
    default:
      return buildAccentStyle("var(--ant-color-fill-quaternary)", token.colorBorderSecondary, token.colorTextSecondary);
  }
}
