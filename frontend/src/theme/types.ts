import type { ThemeConfig } from "antd";

/*  Palette input – everything needed to generate light + dark themes  */

export interface PaletteConfig {
  /** Human-readable label shown in the picker */
  name: string;
  /** Swatch colour for the theme picker dot */
  swatch: string;

  /* Primary colour ramp */
  primaryLight: string;
  primaryDark: string;
  primaryHoverLight: string;
  primaryHoverDark: string;
  primaryActiveLight: string;
  primaryActiveDark: string;

  /* Primary semantic surfaces */
  primaryBgLight: string;
  primaryBgDark: string;
  primaryBorderLight: string;
  primaryBorderDark: string;
  primaryTextLight: string;
  primaryTextDark: string;

  /* Sidebar */
  sidebarLight: string;
  sidebarDark: string;
  menuItemColorLight: string;
  menuItemColorDark: string;
  menuSelectedBgLight: string;
  menuSelectedBgDark: string;
  menuDisabledColorLight: string;
  menuDisabledColorDark: string;

  /* Backgrounds */
  bgLayoutLight: string;
  bgLayoutDark: string;
  bgContainerLight: string;
  bgContainerDark: string;
  bgBaseLight: string;
  bgBaseDark: string;
  /** Slightly elevated surface (cards in dark, subtle lifts in light) */
  bgElevatedLight: string;
  bgElevatedDark: string;

  /* Text */
  textLight: string;
  textDark: string;
  textSecondaryLight: string;
  textSecondaryDark: string;

  /* Borders & splits */
  borderLight: string;
  borderDark: string;
  borderSecondaryLight: string;
  borderSecondaryDark: string;

  /* Status colours (shared across modes unless overridden) */
  success: string;
  warning: string;
  error: string;
  info: string;

  /* Chart palette – 8 distinct colours for data visualisation */
  chartPalette: [string, string, string, string, string, string, string, string];
}

/*  App-specific extras (beyond Ant Design tokens)                     */

export interface AppExtras {
  /** CSS gradient for the sidebar background */
  sidebarGradient: string;
  /** CSS gradient for full-page backgrounds (login, empty states) */
  pageGradient: string;
  /** CSS box-shadow with a themed glow for elevated cards */
  cardGlow: string;
  /** 8-colour chart palette */
  chartPalette: readonly string[];
  /** Accent surface colour for custom widgets */
  accentSurface: string;
  /** Subtle hover fill for custom interactive areas */
  hoverFill: string;
  /** Input surface background */
  inputSurface: string;
}

/*  Full theme output from the factory                                 */

export interface AppTheme {
  name: string;
  swatch: string;
  lightTheme: ThemeConfig;
  darkTheme: ThemeConfig;
  lightExtras: AppExtras;
  darkExtras: AppExtras;
}

/*  Registry types                                                     */

export type ThemeName = string;
