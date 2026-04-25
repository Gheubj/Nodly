import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider, theme } from "antd";
import ruRU from "antd/locale/ru_RU";
import { App } from "@/app/App";
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
    colorBgBase: "#d8dee9",
    colorBgLayout: "#d8dee9",
    colorBgContainer: "rgba(255, 255, 255, 0.52)",
    colorBgElevated: "rgba(255, 255, 255, 0.68)",
    colorText: "#0f172a",
    colorTextSecondary: "#475569",
    colorTextTertiary: "#64748b",
    colorBorder: "rgba(71, 85, 105, 0.22)",
    colorBorderSecondary: "rgba(71, 85, 105, 0.12)",
    colorFillSecondary: "rgba(15, 23, 42, 0.055)",
    colorFillTertiary: "rgba(15, 23, 42, 0.035)",
    colorPrimary: "#355fbd",
    colorPrimaryHover: "#3f6fd4",
    colorLink: "#2d5399",
    colorLinkHover: "#355fbd",
    colorSplit: "rgba(71, 85, 105, 0.14)",
    borderRadius: 12,
    borderRadiusLG: 18,
    controlHeight: 40,
    boxShadow: "0 10px 28px rgba(15, 23, 42, 0.07)",
    boxShadowSecondary: "0 18px 40px rgba(15, 23, 42, 0.1)"
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
        <App />
      </ThemedProviders>
    </BrowserRouter>
  </React.StrictMode>
);
