import { create } from "zustand";
import { apiClient, setAccessToken } from "@/shared/api/client";

export type UserRole = "teacher" | "student";
export type StudentMode = "school" | "direct";

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  studentMode: StudentMode;
  displayName?: string | null;
  spriteSelection?: {
    character?: { id: string; title: string } | null;
    spritePack?: { id: string; title: string } | null;
  } | null;
}

interface SessionState {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (args: {
    email: string;
    password: string;
    role: UserRole;
    studentMode: StudentMode;
    displayName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  loading: false,
  setUser: (user) => set({ user }),
  login: async (email, password) => {
    set({ loading: true });
    try {
      const data = await apiClient.post<{ accessToken: string; user: SessionUser }>("/api/auth/login", {
        email,
        password
      });
      setAccessToken(data.accessToken);
      set({ user: data.user, loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  register: async ({ email, password, role, studentMode, displayName }) => {
    set({ loading: true });
    try {
      const data = await apiClient.post<{ accessToken: string; user: SessionUser }>("/api/auth/register", {
        email,
        password,
        role,
        studentMode,
        displayName
      });
      setAccessToken(data.accessToken);
      set({ user: data.user, loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  logout: async () => {
    await apiClient.post<{ ok: boolean }>("/api/auth/logout");
    setAccessToken("");
    set({ user: null });
  },
  refreshMe: async () => {
    try {
      const me = await apiClient.get<SessionUser>("/api/me");
      set({ user: me });
    } catch {
      set({ user: null });
    }
  }
}));

