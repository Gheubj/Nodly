const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

const ACCESS_STORAGE_KEY = "nodly_access_token";
const LEGACY_ACCESS_STORAGE_KEY = "noda_access_token";

let accessToken = "";

function readPersistedAccessToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  // OAuth (Яндекс) редирект кладёт токен в query до первого React effect — иначе restoreSession
  // успевает вызвать /api/me без Bearer, получить 401 и очистить токен гонкой с useEffect.
  const fromQuery = new URLSearchParams(window.location.search).get("access_token");
  if (fromQuery) {
    localStorage.setItem(ACCESS_STORAGE_KEY, fromQuery);
    localStorage.removeItem(LEGACY_ACCESS_STORAGE_KEY);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(ACCESS_STORAGE_KEY);
      sessionStorage.removeItem(LEGACY_ACCESS_STORAGE_KEY);
    }
    return fromQuery;
  }
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
    const refresh = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      credentials: "include"
    });
    if (refresh.ok) {
      const data = (await refresh.json()) as { accessToken?: string };
      if (data.accessToken) {
        setAccessToken(data.accessToken);
        return request<T>(path, init);
      }
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
    const refresh = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      credentials: "include"
    });
    if (refresh.ok) {
      const data = (await refresh.json()) as { accessToken?: string };
      if (data.accessToken) {
        setAccessToken(data.accessToken);
        return requestForm<T>(path, formData);
      }
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
