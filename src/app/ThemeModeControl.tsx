import type { ReactNode } from "react";
import { LaptopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { useThemeStore, type ThemeMode } from "@/store/useThemeStore";

type Props = {
  /** Стили для встраивания в синюю шапку */
  variant?: "header" | "default";
};

const MODES: { value: ThemeMode; label: string; short: string; icon: ReactNode }[] = [
  { value: "light", label: "Светлая", short: "Свет", icon: <SunOutlined className="settings-theme-toggle__icon" /> },
  { value: "dark", label: "Тёмная", short: "Тёмн", icon: <MoonOutlined className="settings-theme-toggle__icon" /> },
  {
    value: "system",
    label: "Система",
    short: "Авто",
    icon: <LaptopOutlined className="settings-theme-toggle__icon" />
  }
];

export function ThemeModeControl({ variant = "default" }: Props) {
  const themeMode = useThemeStore((s) => s.themeMode);
  const setThemeMode = useThemeStore((s) => s.setThemeMode);
  const compact = variant === "header";

  return (
    <div
      className={`settings-theme-toggle${compact ? " settings-theme-toggle--header" : ""}`}
      role="radiogroup"
      aria-label="Тема оформления"
    >
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={themeMode === m.value}
          className={`settings-theme-toggle__btn${themeMode === m.value ? " settings-theme-toggle__btn--active" : ""}`}
          onClick={() => setThemeMode(m.value)}
        >
          {m.icon}
          {compact ? m.short : m.label}
        </button>
      ))}
    </div>
  );
}
