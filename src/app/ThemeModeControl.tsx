import { Segmented } from "antd";
import { LaptopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { useThemeStore, type ThemeMode } from "@/store/useThemeStore";

type Props = {
  /** Стили для встраивания в синюю шапку */
  variant?: "header" | "default";
};

export function ThemeModeControl({ variant = "default" }: Props) {
  const themeMode = useThemeStore((s) => s.themeMode);
  const setThemeMode = useThemeStore((s) => s.setThemeMode);

  const options =
    variant === "header"
      ? [
          { value: "light" as const, icon: <SunOutlined />, label: "Свет" },
          { value: "dark" as const, icon: <MoonOutlined />, label: "Тёмн" },
          { value: "system" as const, icon: <LaptopOutlined />, label: "Авто" }
        ]
      : [
          { value: "light" as const, icon: <SunOutlined />, label: "Светлая" },
          { value: "dark" as const, icon: <MoonOutlined />, label: "Тёмная" },
          { value: "system" as const, icon: <LaptopOutlined />, label: "Система" }
        ];

  return (
    <Segmented<ThemeMode>
      size="small"
      value={themeMode}
      aria-label="Тема оформления"
      className={variant === "header" ? "app-header-theme-segmented" : undefined}
      onChange={(v) => setThemeMode(v)}
      options={options}
    />
  );
}
