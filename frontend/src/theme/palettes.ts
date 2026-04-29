import type { PaletteConfig } from "./types";
import { darken } from "./utils";

/* ── Per-theme dark base ───────────────────────────────────────────
   Derives all dark surface levels from each palette's primaryBgDark
   seed so backgrounds carry the correct theme tint in dark mode.   */

function buildDarkBase(seed: string) {
  return {
    bgBaseDark:      darken(seed, 0.55),
    bgLayoutDark:    darken(seed, 0.45),
    bgContainerDark: darken(seed, 0.30),
    bgElevatedDark:  darken(seed, 0.10),
    sidebarDark:     darken(seed, 0.60),
  };
}

const status = {
  success: "#00F5A0",          // neon mint — readable on near-black
  warning: "#FFB627",          // vivid amber
  error: "#FF3864",            // neon coral-red
} as const;

/* ── Chart palette: brand colour first, then shared neon accents ── */
function buildChartPalette(
  primary: string,
): [string, string, string, string, string, string, string, string] {
  return [
    primary,
    "#B97AFF", // soft violet
    "#00E5FF", // electric cyan
    "#00F5A0", // neon mint
    "#FFB627", // vivid amber
    "#FF3864", // neon coral
    "#7B8CFF", // periwinkle
    "#FF79C6", // neon pink
  ];
}

/* ── Palettes ────────────────────────────────────────────────────── */

const palettes: Record<string, PaletteConfig> = {

  /* ── 1. Neon Violet — cyber hero ─────────────────────────────── */
  neonViolet: {
    name: "Neon Violet",
    swatch: "#A855F7",

    primaryLight: "#7C3AED",
    primaryDark: "#C084FC",
    primaryHoverLight: "#6D28D9",
    primaryHoverDark: "#D8B4FE",
    primaryActiveLight: "#5B21B6",
    primaryActiveDark: "#A855F7",

    primaryBgLight: "#F5F0FF",
    primaryBgDark: "#1A0D2E",          // deep violet-black
    primaryBorderLight: "#DDD6FE",
    primaryBorderDark: "#6B21A8",
    primaryTextLight: "#4C1D95",
    primaryTextDark: "#EDD9FF",

    sidebarLight: "#1E0A3C",
    menuItemColorLight: "#E9D5FF",
    menuSelectedBgLight: "#7C3AED",
    menuSelectedBgDark: "#6B21A8",
    menuDisabledColorLight: "#A78BFA",

    bgBaseLight: "#FDFBFF",
    bgLayoutLight: "#F7F3FF",
    bgContainerLight: "#FFFFFF",
    bgElevatedLight: "#FBF8FF",

    textLight: "#1A0F2E",
    textDark: "#F0E6FF",
    textSecondaryLight: "#6B5A8A",
    textSecondaryDark: "#B09DCC",
    borderLight: "#EAE0FA",
    borderDark: "#2D1F4A",
    borderSecondaryLight: "#F3EEFF",
    borderSecondaryDark: "#3A2860",

    menuItemColorDark: "#DEC9FF",
    menuDisabledColorDark: "#7A6A9C",

    ...buildDarkBase("#1A0D2E"),
    ...status,
    info: "#A855F7",
    chartPalette: buildChartPalette("#A855F7"),
  },

  /* ── 2. Arctic — ice blue, cold & sharp ─────────────────────── */
  arctic: {
    name: "Arctic",
    swatch: "#00D4FF",

    primaryLight: "#0891B2",
    primaryDark: "#00D4FF",
    primaryHoverLight: "#0E7490",
    primaryHoverDark: "#67E8F9",
    primaryActiveLight: "#155E75",
    primaryActiveDark: "#00B8DB",

    primaryBgLight: "#F0FEFF",
    primaryBgDark: "#041A20",          // near-black with icy tint
    primaryBorderLight: "#A5F3FC",
    primaryBorderDark: "#0A7A90",
    primaryTextLight: "#083344",
    primaryTextDark: "#CFFAFE",

    sidebarLight: "#051E28",
    menuItemColorLight: "#BAF0F8",
    menuSelectedBgLight: "#0E7490",
    menuSelectedBgDark: "#0A7A90",
    menuDisabledColorLight: "#22D3EE",

    bgBaseLight: "#FAFEFF",
    bgLayoutLight: "#F2FBFD",
    bgContainerLight: "#FFFFFF",
    bgElevatedLight: "#F5FDFF",

    textLight: "#061820",
    textDark: "#E0FAFF",
    textSecondaryLight: "#3A6470",
    textSecondaryDark: "#7BBFCC",
    borderLight: "#CCEEF5",
    borderDark: "#0F2E36",
    borderSecondaryLight: "#DFF7FA",
    borderSecondaryDark: "#163B44",

    menuItemColorDark: "#B0ECF8",
    menuDisabledColorDark: "#457080",

    ...buildDarkBase("#041A20"),
    ...status,
    info: "#00D4FF",
    chartPalette: buildChartPalette("#00D4FF"),
  },

  /* ── 3. Ember — warm amber/gold, rich & modern ───────────────── */
  ember: {
    name: "Ember",
    swatch: "#F59E0B",

    primaryLight: "#D97706",
    primaryDark: "#FCD34D",
    primaryHoverLight: "#B45309",
    primaryHoverDark: "#FDE68A",
    primaryActiveLight: "#92400E",
    primaryActiveDark: "#F59E0B",

    primaryBgLight: "#FFFBEB",
    primaryBgDark: "#1C1200",          // near-black with warm amber undertone
    primaryBorderLight: "#FDE68A",
    primaryBorderDark: "#92600A",
    primaryTextLight: "#78350F",
    primaryTextDark: "#FEF3C7",

    sidebarLight: "#2A1A00",
    menuItemColorLight: "#FDE9A0",
    menuSelectedBgLight: "#B45309",
    menuSelectedBgDark: "#92600A",
    menuDisabledColorLight: "#FCD34D",

    bgBaseLight: "#FFFEFC",
    bgLayoutLight: "#FDFAF0",
    bgContainerLight: "#FFFFFF",
    bgElevatedLight: "#FFFDF5",

    textLight: "#231800",
    textDark: "#FFF7E0",
    textSecondaryLight: "#78600A",
    textSecondaryDark: "#C8A84A",
    borderLight: "#F5E5B0",
    borderDark: "#2E2200",
    borderSecondaryLight: "#FAF0CC",
    borderSecondaryDark: "#3D2E00",

    menuItemColorDark: "#F8E080",
    menuDisabledColorDark: "#8A7030",

    ...buildDarkBase("#1C1200"),
    ...status,
    info: "#F59E0B",
    chartPalette: buildChartPalette("#F59E0B"),
  },

  /* ── 4. Graphite — monochrome, ultra-clean ───────────────────── */
  graphite: {
    name: "Graphite",
    swatch: "#9CA3AF",

    primaryLight: "#6B7280",
    primaryDark: "#D1D5DB",
    primaryHoverLight: "#4B5563",
    primaryHoverDark: "#E5E7EB",
    primaryActiveLight: "#374151",
    primaryActiveDark: "#9CA3AF",

    primaryBgLight: "#F8F9FA",
    primaryBgDark: "#111214",          // coolest near-black, no tint
    primaryBorderLight: "#E5E7EB",
    primaryBorderDark: "#3A3D42",
    primaryTextLight: "#111827",
    primaryTextDark: "#F3F4F6",

    sidebarLight: "#181A1D",
    menuItemColorLight: "#D4D6DA",
    menuSelectedBgLight: "#4B5563",
    menuSelectedBgDark: "#3A3D42",
    menuDisabledColorLight: "#9CA3AF",

    bgBaseLight: "#FAFAFA",
    bgLayoutLight: "#F4F5F6",
    bgContainerLight: "#FFFFFF",
    bgElevatedLight: "#F9F9FA",

    textLight: "#111827",
    textDark: "#F1F3F5",
    textSecondaryLight: "#6B7280",
    textSecondaryDark: "#9EA3AD",
    borderLight: "#E5E7EB",
    borderDark: "#272A2E",
    borderSecondaryLight: "#F0F1F3",
    borderSecondaryDark: "#323538",

    menuItemColorDark: "#CDD0D5",
    menuDisabledColorDark: "#6B7280",

    ...buildDarkBase("#111214"),
    ...status,
    info: "#9CA3AF",
    chartPalette: buildChartPalette("#9CA3AF"),
  },

  /* ── 5. Plasma — cyan/green, terminal hacker energy ─────────── */
  plasma: {
    name: "Plasma",
    swatch: "#00F5A0",

    primaryLight: "#059669",
    primaryDark: "#00F5A0",
    primaryHoverLight: "#047857",
    primaryHoverDark: "#6EFFD4",
    primaryActiveLight: "#065F46",
    primaryActiveDark: "#00D48A",

    primaryBgLight: "#F0FFF8",
    primaryBgDark: "#001A10",          // near-black with deep green tint
    primaryBorderLight: "#6EE7B7",
    primaryBorderDark: "#006644",
    primaryTextLight: "#064E3B",
    primaryTextDark: "#CCFFF0",

    sidebarLight: "#001A10",
    menuItemColorLight: "#9EFFD8",
    menuSelectedBgLight: "#047857",
    menuSelectedBgDark: "#006644",
    menuDisabledColorLight: "#34D399",

    bgBaseLight: "#FBFFFE",
    bgLayoutLight: "#F2FDF8",
    bgContainerLight: "#FFFFFF",
    bgElevatedLight: "#F5FEFB",

    textLight: "#001A10",
    textDark: "#DAFFEF",
    textSecondaryLight: "#2A6E50",
    textSecondaryDark: "#70C4A0",
    borderLight: "#C0F0DC",
    borderDark: "#0A2E1E",
    borderSecondaryLight: "#DAFAEF",
    borderSecondaryDark: "#103A26",

    menuItemColorDark: "#88F5CC",
    menuDisabledColorDark: "#2E7A58",

    ...buildDarkBase("#001A10"),
    ...status,
    info: "#00F5A0",
    chartPalette: buildChartPalette("#00F5A0"),
  },
};

export default palettes;