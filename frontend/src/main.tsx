import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider } from "antd";
import { AuthProvider } from "./store/AuthContext";
import { ThemeProvider, useTheme } from "./store/ThemeContext";
import { getThemeConfig } from "./theme";
import App from "./App";
import "./index.css";

function ThemeWrapper({ children }: { children: React.ReactNode }) {
  const { mode, themeName } = useTheme();
  const config = getThemeConfig(themeName, mode);

  useEffect(() => {
    const token = config.token as Record<string, unknown> | undefined;
    const bgBase = token?.colorBgBase as string | undefined;
    const colorText = token?.colorText as string | undefined;
    const primary = token?.colorPrimary as string | undefined;
    const primaryBg = token?.colorPrimaryBg as string | undefined;
    document.body.style.background = bgBase ?? (mode === "dark" ? "#0F0B1A" : "#FFFFFF");
    document.body.style.color = colorText ?? "";
    const root = document.documentElement;
    if (primary) root.style.setProperty("--app-scrollbar-thumb", primary);
    if (primaryBg) root.style.setProperty("--app-scrollbar-track", primaryBg);
  }, [mode, themeName, config]);

  return <ConfigProvider theme={config}>{children}</ConfigProvider>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemeWrapper>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ThemeWrapper>
    </ThemeProvider>
  </React.StrictMode>
);
