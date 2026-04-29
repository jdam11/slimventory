/**
 * Re-export shim – everything now lives under ./theme/.
 * Existing imports from "./theme" continue to work unchanged.
 */
export {
  THEMES,
  THEME_NAMES,
  getThemeConfig,
  getThemeSwatch,
  getThemeLabel,
  getAppTheme,
  getExtras,
  createAppTheme,
} from "./theme/index";

export type { AppTheme, AppExtras, PaletteConfig, ThemeName } from "./theme/index";
