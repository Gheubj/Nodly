import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "nodly_theme_mode";
const LEGACY_STORAGE_KEY = "noda_theme_mode";

function loadThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "system";
}

interface ThemeState {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  themeMode: loadThemeMode(),
  setThemeMode: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    set({ themeMode: mode });
  }
}));
