import { theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";
import type { PaletteConfig, AppTheme, AppExtras } from "./types";
import { darken } from "./utils";

/*  Shared design tokens                                               */

const FONT_FAMILY =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const BORDER_RADIUS = 8;
const BORDER_RADIUS_SM = 6;
const BORDER_RADIUS_LG = 12;

/*  Light ThemeConfig builder                                          */

function buildLightTheme(p: PaletteConfig): ThemeConfig {
  return {
    token: {
      /* Primary ramp */
      colorPrimary: p.primaryLight,
      colorPrimaryHover: p.primaryHoverLight,
      colorPrimaryActive: p.primaryActiveLight,
      colorPrimaryText: p.primaryTextLight,
      colorPrimaryBg: p.primaryBgLight,
      colorPrimaryBorder: p.primaryBorderLight,

      /* Surfaces */
      colorBgBase: p.bgBaseLight,
      colorBgLayout: p.bgLayoutLight,
      colorBgContainer: p.bgContainerLight,
      colorBgElevated: p.bgElevatedLight,

      /* Text */
      colorText: p.textLight,
      colorTextSecondary: p.textSecondaryLight,

      /* Borders */
      colorBorder: p.borderLight,
      colorBorderSecondary: p.borderSecondaryLight,
      colorSplit: p.borderSecondaryLight,

      /* Fills */
      colorFillSecondary: "rgba(0, 0, 0, 0.04)",
      colorFillTertiary: "rgba(0, 0, 0, 0.03)",
      colorFillQuaternary: "rgba(0, 0, 0, 0.02)",

      /* Status */
      colorSuccess: p.success,
      colorWarning: p.warning,
      colorError: p.error,
      colorInfo: p.info,

      /* Links */
      colorLink: p.primaryLight,
      colorLinkHover: p.primaryHoverLight,

      /* Shape & typography */
      borderRadius: BORDER_RADIUS,
      borderRadiusSM: BORDER_RADIUS_SM,
      borderRadiusLG: BORDER_RADIUS_LG,
      fontFamily: FONT_FAMILY,
      fontSize: 14,

      /* Shadows */
      boxShadow:
        "0 1px 2px 0 rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02), 0 2px 4px 0 rgba(0,0,0,0.02)",
      boxShadowSecondary:
        "0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)",
    },

    components: {
      /* Layout & Navigation */
      Layout: {
        siderBg: p.sidebarLight,
        triggerBg: p.sidebarLight,
        triggerColor: p.menuItemColorLight,
        headerBg: p.bgContainerLight,
        bodyBg: p.bgLayoutLight,
      },
      Menu: {
        darkItemBg: p.sidebarLight,
        darkSubMenuItemBg: p.sidebarLight,
        darkItemColor: p.menuItemColorLight,
        darkItemHoverColor: "#FFFFFF",
        darkItemSelectedBg: p.menuSelectedBgLight,
        darkItemSelectedColor: "#FFFFFF",
        darkItemDisabledColor: p.menuDisabledColorLight,
        itemBorderRadius: BORDER_RADIUS_SM,
      },

      /* Buttons */
      Button: {
        borderRadius: BORDER_RADIUS,
        borderRadiusSM: BORDER_RADIUS_SM,
        borderRadiusLG: BORDER_RADIUS_LG,
        primaryShadow: "0 2px 0 rgba(0,0,0,0.02)",
        defaultShadow: "0 2px 0 rgba(0,0,0,0.02)",
        fontWeight: 500,
      },

      /* Cards */
      Card: {
        borderRadiusLG: BORDER_RADIUS_LG,
        boxShadowTertiary:
          "0 1px 2px 0 rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02), 0 2px 4px 0 rgba(0,0,0,0.02)",
      },

      /* Inputs */
      Input: {
        borderRadius: BORDER_RADIUS,
        borderRadiusSM: BORDER_RADIUS_SM,
        borderRadiusLG: BORDER_RADIUS_LG,
        activeBorderColor: p.primaryLight,
        hoverBorderColor: p.primaryHoverLight,
        colorBgContainer: p.bgContainerLight,
        paddingBlock: 6,
      },

      /* Select */
      Select: {
        borderRadius: BORDER_RADIUS,
        borderRadiusSM: BORDER_RADIUS_SM,
        optionSelectedBg: p.primaryBgLight,
        optionActiveBg: `${p.primaryBgLight}AA`,
        colorBorder: p.borderLight,
      },

      /* Form */
      Form: {
        itemMarginBottom: 14,
      },

      /* Table */
      Table: {
        borderRadius: BORDER_RADIUS,
        borderRadiusLG: BORDER_RADIUS_LG,
        headerBg: p.bgElevatedLight,
        headerColor: p.textLight,
        headerSortActiveBg: p.primaryBgLight,
        headerSortHoverBg: p.primaryBgLight,
        rowHoverBg: `${p.primaryBgLight}80`,
        headerBorderRadius: BORDER_RADIUS,
      },

      /* Tabs */
      Tabs: {
        inkBarColor: p.primaryLight,
        itemActiveColor: p.primaryLight,
        itemHoverColor: p.primaryHoverLight,
        itemSelectedColor: p.primaryLight,
        cardBg: p.bgElevatedLight,
      },

      /* Modal */
      Modal: {
        borderRadiusLG: BORDER_RADIUS_LG,
        headerBg: p.bgContainerLight,
        contentBg: p.bgContainerLight,
        titleFontSize: 18,
      },

      /* Drawer */
      Drawer: {
        colorBgElevated: p.bgContainerLight,
      },
    },
  };
}

/*  Dark ThemeConfig builder                                           */

function buildDarkTheme(p: PaletteConfig): ThemeConfig {
  return {
    algorithm: antdTheme.darkAlgorithm,
    token: {
      /* Primary ramp */
      colorPrimary: p.primaryDark,
      colorPrimaryHover: p.primaryHoverDark,
      colorPrimaryActive: p.primaryActiveDark,
      colorPrimaryText: p.primaryTextDark,
      colorPrimaryBg: p.primaryBgDark,
      colorPrimaryBorder: p.primaryBorderDark,

      /* Surfaces */
      colorBgBase: p.bgBaseDark,
      colorBgLayout: p.bgLayoutDark,
      colorBgContainer: p.bgContainerDark,
      colorBgElevated: p.bgElevatedDark,

      /* Text */
      colorText: p.textDark,
      colorTextSecondary: p.textSecondaryDark,

      /* Borders */
      colorBorder: p.borderDark,
      colorBorderSecondary: p.borderSecondaryDark,
      colorSplit: p.borderSecondaryDark,

      /* Fills */
      colorFillSecondary: "rgba(255, 255, 255, 0.08)",
      colorFillTertiary: "rgba(255, 255, 255, 0.05)",
      colorFillQuaternary: "rgba(255, 255, 255, 0.03)",

      /* Status – slightly brighter in dark mode */
      colorSuccess: "#22C55E",
      colorWarning: "#FBBF24",
      colorError: "#F87171",
      colorInfo: p.info,

      /* Links */
      colorLink: p.primaryDark,
      colorLinkHover: p.primaryHoverDark,

      /* Shape & typography */
      borderRadius: BORDER_RADIUS,
      borderRadiusSM: BORDER_RADIUS_SM,
      borderRadiusLG: BORDER_RADIUS_LG,
      fontFamily: FONT_FAMILY,
      fontSize: 14,

      /* Shadows – heavier for dark surfaces */
      boxShadow:
        "0 1px 2px 0 rgba(0,0,0,0.2), 0 1px 6px -1px rgba(0,0,0,0.15), 0 2px 4px 0 rgba(0,0,0,0.15)",
      boxShadowSecondary:
        "0 6px 16px 0 rgba(0,0,0,0.3), 0 3px 6px -4px rgba(0,0,0,0.25), 0 9px 28px 8px rgba(0,0,0,0.2)",
    },

    components: {
      /* Layout & Navigation */
      Layout: {
        siderBg: p.sidebarDark,
        triggerBg: p.sidebarDark,
        triggerColor: p.textDark,
        headerBg: p.bgContainerDark,
        bodyBg: p.bgLayoutDark,
      },
      Menu: {
        darkItemBg: p.sidebarDark,
        darkSubMenuItemBg: p.sidebarDark,
        darkItemColor: p.menuItemColorDark,
        darkItemHoverColor: "#FFFFFF",
        darkItemSelectedBg: p.menuSelectedBgDark,
        darkItemSelectedColor: "#FFFFFF",
        darkItemDisabledColor: p.menuDisabledColorDark,
        itemBorderRadius: BORDER_RADIUS_SM,
      },

      /* Buttons */
      Button: {
        borderRadius: BORDER_RADIUS,
        borderRadiusSM: BORDER_RADIUS_SM,
        borderRadiusLG: BORDER_RADIUS_LG,
        primaryShadow: `0 2px 8px ${p.primaryDark}26`,
        defaultShadow: "0 2px 0 rgba(0,0,0,0.06)",
        fontWeight: 500,
      },

      /* Cards */
      Card: {
        colorBgContainer: p.bgContainerDark,
        borderRadiusLG: BORDER_RADIUS_LG,
        boxShadowTertiary:
          "0 1px 2px 0 rgba(0,0,0,0.15), 0 1px 6px -1px rgba(0,0,0,0.1), 0 2px 4px 0 rgba(0,0,0,0.1)",
      },

      /* Inputs */
      Input: {
        borderRadius: BORDER_RADIUS,
        borderRadiusSM: BORDER_RADIUS_SM,
        borderRadiusLG: BORDER_RADIUS_LG,
        activeBorderColor: p.primaryDark,
        hoverBorderColor: p.primaryHoverDark,
        colorBgContainer: p.bgElevatedDark,
        paddingBlock: 6,
      },

      /* Select */
      Select: {
        borderRadius: BORDER_RADIUS,
        borderRadiusSM: BORDER_RADIUS_SM,
        optionSelectedBg: p.primaryBgDark,
        optionActiveBg: `${p.primaryBgDark}CC`,
        colorBorder: p.borderDark,
        selectorBg: p.bgElevatedDark,
      },

      /* Form */
      Form: {
        itemMarginBottom: 14,
      },

      /* Table */
      Table: {
        borderRadius: BORDER_RADIUS,
        borderRadiusLG: BORDER_RADIUS_LG,
        headerBg: p.bgElevatedDark,
        headerColor: p.textDark,
        headerSortActiveBg: p.primaryBgDark,
        headerSortHoverBg: p.primaryBgDark,
        rowHoverBg: `${p.primaryBgDark}40`,
        headerBorderRadius: BORDER_RADIUS,
      },

      /* Tabs */
      Tabs: {
        inkBarColor: p.primaryDark,
        itemActiveColor: p.primaryDark,
        itemHoverColor: p.primaryHoverDark,
        itemSelectedColor: p.primaryDark,
        cardBg: p.bgElevatedDark,
      },

      /* Modal */
      Modal: {
        borderRadiusLG: BORDER_RADIUS_LG,
        headerBg: p.bgContainerDark,
        contentBg: p.bgContainerDark,
        titleFontSize: 18,
      },

      /* Drawer */
      Drawer: {
        colorBgElevated: p.bgContainerDark,
      },
    },
  };
}

/*  App extras builder                                                 */

function buildLightExtras(p: PaletteConfig): AppExtras {
  return {
    sidebarGradient: `linear-gradient(180deg, ${p.sidebarLight} 0%, ${darken(p.sidebarLight, 0.15)} 100%)`,
    pageGradient: `linear-gradient(135deg, ${p.primaryBgLight} 0%, ${p.bgLayoutLight} 50%, ${p.bgContainerLight} 100%)`,
    cardGlow: `0 0 0 1px ${p.borderLight}, 0 2px 8px ${p.primaryLight}08`,
    chartPalette: p.chartPalette,
    accentSurface: p.primaryBgLight,
    hoverFill: "rgba(0, 0, 0, 0.04)",
    inputSurface: p.bgContainerLight,
  };
}

function buildDarkExtras(p: PaletteConfig): AppExtras {
  return {
    sidebarGradient: `linear-gradient(180deg, ${p.sidebarDark} 0%, ${darken(p.sidebarDark, 0.2)} 100%)`,
    pageGradient: `linear-gradient(135deg, ${p.bgBaseDark} 0%, ${p.bgLayoutDark} 50%, ${p.bgContainerDark} 100%)`,
    cardGlow: `0 0 0 1px ${p.borderDark}, 0 2px 12px ${p.primaryDark}12`,
    chartPalette: p.chartPalette,
    accentSurface: p.primaryBgDark,
    hoverFill: "rgba(255, 255, 255, 0.06)",
    inputSurface: p.bgElevatedDark,
  };
}

/*  Public factory                                                     */

export function createAppTheme(palette: PaletteConfig): AppTheme {
  return {
    name: palette.name,
    swatch: palette.swatch,
    lightTheme: buildLightTheme(palette),
    darkTheme: buildDarkTheme(palette),
    lightExtras: buildLightExtras(palette),
    darkExtras: buildDarkExtras(palette),
  };
}
