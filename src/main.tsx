import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider, theme } from "antd";
import ruRU from "antd/locale/ru_RU";
import { App } from "@/app/App";
import { NarrowScreenGate } from "@/app/NarrowScreenGate";
import { useThemeStore, type ThemeMode } from "@/store/useThemeStore";
import "@/app/styles.css";

function useEffectiveDark(themeMode: ThemeMode): boolean {
  const [systemDark, setSystemDark] = React.useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false
  );

  React.useEffect(() => {
    if (themeMode !== "system") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeMode]);

  if (themeMode === "light") {
    return false;
  }
  if (themeMode === "dark") {
    return true;
  }
  return systemDark;
}

function ThemedProviders({ children }: { children: React.ReactNode }) {
  const themeMode = useThemeStore((s) => s.themeMode);
  const isDark = useEffectiveDark(themeMode);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, [isDark]);

  const lightTokens = {
    fontFamily: "Inter, Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    colorBgBase: "#eef2f8",
    colorBgLayout: "#eef2f8",
    colorBgContainer: "rgba(255, 255, 255, 0.84)",
    colorBgElevated: "rgba(255, 255, 255, 0.94)",
    colorText: "#0f172a",
    colorTextSecondary: "#4e5f7c",
    colorTextTertiary: "#667892",
    colorBorder: "rgba(134, 153, 182, 0.28)",
    colorBorderSecondary: "rgba(134, 153, 182, 0.16)",
    colorFillSecondary: "rgba(30, 41, 59, 0.06)",
    colorFillTertiary: "rgba(30, 41, 59, 0.04)",
    colorPrimary: "#2f6df6",
    colorPrimaryHover: "#4682ff",
    colorLink: "#2b64e8",
    colorLinkHover: "#3e79fb",
    colorSplit: "rgba(134, 153, 182, 0.18)",
    borderRadius: 12,
    borderRadiusLG: 18,
    controlHeight: 40,
    boxShadow: "0 12px 34px rgba(15, 23, 42, 0.09)",
    boxShadowSecondary: "0 20px 42px rgba(15, 23, 42, 0.14)"
  };

  const darkTokens = {
    fontFamily: "Inter, Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    colorBgBase: "#070c14",
    colorBgLayout: "#070c14",
    colorBgContainer: "rgba(15, 23, 42, 0.78)",
    colorBgElevated: "rgba(15, 23, 42, 0.9)",
    colorText: "#e6ecf7",
    colorBorder: "rgba(123, 146, 180, 0.34)",
    colorTextSecondary: "#a0b3cf",
    colorFillSecondary: "rgba(123, 146, 180, 0.16)",
    colorFillTertiary: "rgba(123, 146, 180, 0.11)",
    colorPrimary: "#5b8cff",
    colorPrimaryHover: "#77a3ff",
    borderRadius: 12,
    borderRadiusLG: 18,
    controlHeight: 40,
    boxShadow: "0 18px 36px rgba(0, 0, 0, 0.42)",
    boxShadowSecondary: "0 24px 54px rgba(0, 0, 0, 0.54)"
  };

  return (
    <ConfigProvider
      locale={ruRU}
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: isDark ? darkTokens : lightTokens
      }}
    >
      {children}
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemedProviders>
        <NarrowScreenGate>
          <App />
        </NarrowScreenGate>
      </ThemedProviders>
    </BrowserRouter>
  </React.StrictMode>
);
