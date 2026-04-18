import { getApiBaseUrl } from "@/shared/api/client";

/** Абсолютный URL для iframe/ссылок, если в БД лежит путь от API (`/api/...`). */
export function resolveLessonMediaUrl(raw: string | null | undefined): string {
  if (raw == null || raw === "") {
    return "";
  }
  const s = raw.trim();
  if (s === "") {
    return "";
  }
  if (/^https?:\/\//i.test(s)) {
    return s;
  }
  if (s.startsWith("//")) {
    if (typeof window !== "undefined" && window.location?.protocol) {
      return `${window.location.protocol}${s}`;
    }
    return `https:${s}`;
  }
  if (s.startsWith("data:") || s.startsWith("blob:")) {
    return s;
  }
  const base = getApiBaseUrl().replace(/\/$/, "");
  if (s.startsWith("/uploads/lesson-images/") || s.startsWith("/uploads/lesson-pdfs/")) {
    return `${base}/api${s}`;
  }
  if (s.startsWith("/")) {
    return `${base}${s}`;
  }
  /* Без ведущего «/» браузер грузит с origin фронта (5173), а не API — частая причина «нет картинки у ученика». */
  if (/^api\//i.test(s)) {
    return `${base}/${s}`;
  }
  if (/^uploads\/lesson-(images|pdfs)\//i.test(s)) {
    return `${base}/api/${s}`;
  }
  return s;
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
