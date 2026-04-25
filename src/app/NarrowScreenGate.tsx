import type { ReactNode } from "react";

/**
 * Раньше блокировал UI на ширине < 768px; теперь приложение поддерживает
 * мобильные виджеты, и компонент оставлен как passthrough только для
 * совместимости с возможными внешними импортами.
 */
export const MIN_VIEWPORT_WIDTH_PX = 360;

export function NarrowScreenGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
