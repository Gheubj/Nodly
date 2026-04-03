const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

const ACCESS_STORAGE_KEY = "noda_access_token";

let accessToken = "";

function readPersistedAccessToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  let stored = localStorage.getItem(ACCESS_STORAGE_KEY);
  if (!stored && typeof sessionStorage !== "undefined") {
    const legacy = sessionStorage.getItem(ACCESS_STORAGE_KEY);
    if (legacy) {
      localStorage.setItem(ACCESS_STORAGE_KEY, legacy);
      sessionStorage.removeItem(ACCESS_STORAGE_KEY);
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
    } else {
      localStorage.removeItem(ACCESS_STORAGE_KEY);
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(ACCESS_STORAGE_KEY);
      }
    }
  }
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
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined })
};
