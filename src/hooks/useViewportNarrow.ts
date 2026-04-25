import { useEffect, useState } from "react";

/**
 * Дизайн-система брейкпоинтов (mobile-first):
 * - xxs ≤ 480 — узкий телефон
 * - xs  481-720 — телефон / большой телефон
 * - sm  721-960 — маленький планшет
 * - md  961-1200 — планшет / небольшой ноут
 * - lg  ≥ 1201 — десктоп
 */
export const VIEWPORT = {
  xxs: 480,
  xs: 720,
  sm: 960,
  md: 1200
} as const;

function matches(query: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia(query).matches;
}

/**
 * Возвращает true когда ширина окна ≤ maxWidth. Подписан на resize
 * через matchMedia (без debounce — браузер уже throttle'ит).
 */
export function useViewportMaxWidth(maxWidth: number): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [hit, setHit] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const mql = window.matchMedia(query);
    const onChange = () => setHit(mql.matches);
    setHit(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return hit;
}

/** ≤ 720px — телефон в портрете и landscape, маленькие планшеты в портрете. */
export function useIsPhone(): boolean {
  return useViewportMaxWidth(VIEWPORT.xs);
}

/** ≤ 960px — телефоны + маленькие планшеты. */
export function useIsTabletOrPhone(): boolean {
  return useViewportMaxWidth(VIEWPORT.sm);
}
