import type { ThemeConfig } from "antd";
import { createAppTheme } from "./createAppTheme";
import palettes from "./palettes";
import type { AppTheme, AppExtras, PaletteConfig, ThemeName } from "./types";

/*  Build the registry from palettes                                   */

const THEMES: Record<string, AppTheme> = Object.fromEntries(
  Object.entries(palettes).map(([key, palette]) => [key, createAppTheme(palette)]),
);

/*  Public constants                                                   */

/** Ordered list of all registered theme keys. */
const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

/** Fallback theme — first entry in the palette registry. */
const DEFAULT_THEME = THEMES[THEME_NAMES[0]];

/*  Public helpers (backward-compatible API)                           */

function getThemeConfig(name: string, mode: "light" | "dark"): ThemeConfig {
  const t = THEMES[name] ?? DEFAULT_THEME;
  return mode === "dark" ? t.darkTheme : t.lightTheme;
}

function getThemeSwatch(name: string): string {
  return (THEMES[name] ?? DEFAULT_THEME).swatch;
}

function getThemeLabel(name: string): string {
  return (THEMES[name] ?? DEFAULT_THEME).name;
}

/** Get the full AppTheme for a named theme (includes extras). */
function getAppTheme(name: string): AppTheme {
  return THEMES[name] ?? DEFAULT_THEME;
}

/** Get the extras bag for the current mode. */
function getExtras(name: string, mode: "light" | "dark"): AppExtras {
  const t = THEMES[name] ?? DEFAULT_THEME;
  return mode === "dark" ? t.darkExtras : t.lightExtras;
}

/*  Exports                                                            */

export { THEMES, THEME_NAMES, getThemeConfig, getThemeSwatch, getThemeLabel, getAppTheme, getExtras };
export { createAppTheme } from "./createAppTheme";
export type { AppTheme, AppExtras, PaletteConfig, ThemeName } from "./types";
