const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

const ACCESS_STORAGE_KEY = "nodly_access_token";
const LEGACY_ACCESS_STORAGE_KEY = "noda_access_token";

let accessToken = "";

function readPersistedAccessToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  // Access-токен НЕ принимаем из query-параметров: URL попадает в access-логи бэкенда
  // и фронтового CDN, в Referer и в историю браузера. Даже если legacy-бэкенд
  // добавил ?access_token=..., мы не используем это значение — токен будет получен
  // через /api/auth/refresh по httpOnly refresh-cookie (см. restoreSession).
  let stored = localStorage.getItem(ACCESS_STORAGE_KEY) ?? localStorage.getItem(LEGACY_ACCESS_STORAGE_KEY);
  if (stored && !localStorage.getItem(ACCESS_STORAGE_KEY)) {
    localStorage.setItem(ACCESS_STORAGE_KEY, stored);
    localStorage.removeItem(LEGACY_ACCESS_STORAGE_KEY);
  }
  if (!stored && typeof sessionStorage !== "undefined") {
    const legacy =
      sessionStorage.getItem(ACCESS_STORAGE_KEY) ?? sessionStorage.getItem(LEGACY_ACCESS_STORAGE_KEY);
    if (legacy) {
      localStorage.setItem(ACCESS_STORAGE_KEY, legacy);
      sessionStorage.removeItem(ACCESS_STORAGE_KEY);
      sessionStorage.removeItem(LEGACY_ACCESS_STORAGE_KEY);
      stored = legacy;
    }
  }
  return stored ?? "";
}

accessToken = readPersistedAccessToken();

export interface RefreshResult {
  ok: boolean;
  accessToken: string | null;
}

/**
 * Один in-flight POST /api/auth/refresh — иначе два параллельных /me дают
 * два refresh и гонку на сервере (rotation удалит старый refresh-токен
 * только один раз → второй параллельный вызов получит 401 и выкинет юзера).
 *
 * Кешируем УЖЕ ПРОЧИТАННЫЙ payload, а не Response: тело fetch-Response —
 * one-shot stream, попытка повторного `.json()` второго ожидающего бросает
 * TypeError ("body stream already read") и роняет ретрай 401 для всех,
 * кроме первого ожидающего.
 */
let refreshInflight: Promise<RefreshResult> | null = null;

export function postAuthRefresh(): Promise<RefreshResult> {
  if (!refreshInflight) {
    refreshInflight = (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: "POST",
          credentials: "include"
        });
        if (!r.ok) {
          return { ok: false, accessToken: null };
        }
        let token: string | null = null;
        try {
          const data = (await r.json()) as { accessToken?: string } | null;
          token = typeof data?.accessToken === "string" && data.accessToken.length > 0 ? data.accessToken : null;
        } catch {
          token = null;
        }
        return { ok: true, accessToken: token };
      } catch {
        return { ok: false, accessToken: null };
      } finally {
        refreshInflight = null;
      }
    })();
  }
  return refreshInflight;
}

export function getApiBaseUrl() {
  return API_BASE;
}

export function setAccessToken(token: string) {
  accessToken = token;
  if (typeof window !== "undefined") {
    if (token) {
      localStorage.setItem(ACCESS_STORAGE_KEY, token);
      localStorage.removeItem(LEGACY_ACCESS_STORAGE_KEY);
    } else {
      localStorage.removeItem(ACCESS_STORAGE_KEY);
      localStorage.removeItem(LEGACY_ACCESS_STORAGE_KEY);
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(ACCESS_STORAGE_KEY);
        sessionStorage.removeItem(LEGACY_ACCESS_STORAGE_KEY);
      }
    }
  }
}

export class ApiError extends Error {
  status: number;
  userMessage: string;

  constructor(status: number, userMessage: string, message?: string) {
    super(message ?? userMessage);
    this.name = "ApiError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

function mapStatusToUserMessage(status: number): string {
  if (status === 401) {
    return "Нужен вход в аккаунт";
  }
  if (status === 403) {
    return "Нет доступа";
  }
  if (status === 404) {
    return "Объект не найден";
  }
  if (status >= 500) {
    return "Сервис временно недоступен";
  }
  return "Не удалось выполнить запрос";
}

export function toUserErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.userMessage;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Произошла ошибка";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers
  });
  if (response.status === 401 && path !== "/api/auth/refresh") {
    const refresh = await postAuthRefresh();
    if (refresh.ok && refresh.accessToken) {
      setAccessToken(refresh.accessToken);
      return request<T>(path, init);
    }
    setAccessToken("");
  }
  if (!response.ok) {
    let apiError: string | undefined;
    let fallbackText = "";
    try {
      const data = (await response.json()) as { error?: string; message?: string };
      apiError = typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : "";
    } catch {
      fallbackText = await response.text();
    }
    const userMessage = apiError?.trim() || fallbackText.trim() || mapStatusToUserMessage(response.status);
    throw new ApiError(response.status, userMessage, `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function requestForm<T>(path: string, formData: FormData): Promise<T> {
  const headers = new Headers();
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: formData,
    credentials: "include",
    headers
  });
  if (response.status === 401 && path !== "/api/auth/refresh") {
    const refresh = await postAuthRefresh();
    if (refresh.ok && refresh.accessToken) {
      setAccessToken(refresh.accessToken);
      return requestForm<T>(path, formData);
    }
    setAccessToken("");
  }
  if (!response.ok) {
    let apiError: string | undefined;
    let fallbackText = "";
    try {
      const data = (await response.json()) as { error?: string; message?: string };
      apiError = typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : "";
    } catch {
      fallbackText = await response.text();
    }
    const userMessage = apiError?.trim() || fallbackText.trim() || mapStatusToUserMessage(response.status);
    throw new ApiError(response.status, userMessage, `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  postForm: <T>(path: string, formData: FormData) => requestForm<T>(path, formData),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" })
};
