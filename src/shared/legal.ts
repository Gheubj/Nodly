import { message } from "antd";
import { getApiBaseUrl } from "@/shared/api/client";

export const NODLY_CONTACT_EMAIL = "Nodly.edu@mail.ru";

export const LEGAL_PRIVACY_POLICY_FILE = "privacy-policy.pdf" as const;
export const LEGAL_USER_AGREEMENT_FILE = "user-agreement.pdf" as const;

export type LegalPdfFile = typeof LEGAL_PRIVACY_POLICY_FILE | typeof LEGAL_USER_AGREEMENT_FILE;

const SAVE_AS: Record<LegalPdfFile, string> = {
  "privacy-policy.pdf": "Nodly-privacy-policy.pdf",
  "user-agreement.pdf": "Nodly-user-agreement.pdf"
};

/** Полный URL бэкенда — на проде `/api/...` на домене фронта часто отдаёт SPA вместо PDF. */
export function legalPdfFetchUrl(file: LegalPdfFile): string {
  return `${getApiBaseUrl().replace(/\/$/, "")}/api/legal/${file}`;
}

/**
 * Скачивание через fetch + blob: надёжно обходит SPA и встроенный просмотрщик PDF в браузере.
 */
export async function downloadLegalPdf(file: LegalPdfFile): Promise<void> {
  const url = legalPdfFetchUrl(file);
  const saveAs = SAVE_AS[file];
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", credentials: "omit", mode: "cors" });
  } catch {
    message.error("Не удалось связаться с сервером. Проверьте, что API запущен и VITE_API_BASE_URL верный.");
    return;
  }
  if (!res.ok) {
    message.error(`Документ недоступен (код ${res.status}).`);
    return;
  }
  const ct = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (ct && !/application\/pdf|application\/octet-stream/i.test(ct)) {
    message.error("Сервер вернул не PDF — проверьте настройки прокси и адрес API.");
    return;
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = saveAs;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
