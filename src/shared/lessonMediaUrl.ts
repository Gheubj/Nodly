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

/** Меньше панелей у встроенного просмотрщика PDF в iframe. */
export function pdfEmbedUrl(raw: string | null | undefined): string {
  const base = resolveLessonMediaUrl(raw);
  if (!base) {
    return "";
  }
  if (base.includes("#")) {
    return base;
  }
  return `${base}#toolbar=0&navpanes=0`;
}
