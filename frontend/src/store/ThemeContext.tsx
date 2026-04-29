import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { THEMES, THEME_NAMES } from "../theme";

export type ThemeMode = "light" | "dark";

interface ThemeState {
  mode: ThemeMode;
  themeName: string;
  setMode: (mode: ThemeMode) => void;
  setThemeName: (name: string) => void;
  toggleTheme: () => void;
}

const THEME_STORAGE_KEY = "slim-theme";
const THEME_NAME_STORAGE_KEY = "slim-theme-name";

function getInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }

  const persisted = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (persisted === "light" || persisted === "dark") {
    return persisted;
  }

  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }

  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "dark";
}

function getInitialThemeName(): string {
  if (typeof window === "undefined") {
    return THEME_NAMES[0];
  }
  const persisted = window.localStorage.getItem(THEME_NAME_STORAGE_KEY);
  if (persisted && persisted in THEMES) {
    return persisted;
  }
  return THEME_NAMES[0];
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => getInitialThemeMode());
  const [themeName, setThemeNameState] = useState<string>(() => getInitialThemeName());

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    }
  }, []);

  const setThemeName = useCallback((name: string) => {
    setThemeNameState(name);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_NAME_STORAGE_KEY, name);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  const value = useMemo(
    () => ({ mode, themeName, setMode, setThemeName, toggleTheme }),
    [mode, themeName, setMode, setThemeName, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
