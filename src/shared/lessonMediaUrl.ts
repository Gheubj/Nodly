import { getApiBaseUrl } from "@/shared/api/client";

/** Абсолютный URL для iframe/ссылок, если в БД лежит путь от API (`/api/...`). */
export function resolveLessonMediaUrl(raw: string | null | undefined): string {
  if (raw == null || raw === "") {
    return "";
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (raw.startsWith("/")) {
    return `${getApiBaseUrl()}${raw}`;
  }
  return raw;
}
