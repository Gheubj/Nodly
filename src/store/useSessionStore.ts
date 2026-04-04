import { create } from "zustand";
import { apiClient, getApiBaseUrl, setAccessToken } from "@/shared/api/client";

export type UserRole = "teacher" | "student";
export type StudentMode = "school" | "direct";

export interface SessionEnrollment {
  id: string;
  classroomId: string;
  classroomTitle: string;
  classCode: string;
  schoolName: string;
  teacherNickname: string;
  teacherEmail: string;
}

export interface SessionUser {
  id: string;
  email: string;
  nickname: string;
  role: UserRole;
  studentMode: StudentMode;
  isAdmin?: boolean;
  enrollments?: SessionEnrollment[];
  spriteSelection?: {
    character?: { id: string; title: string } | null;
    spritePack?: { id: string; title: string } | null;
  } | null;
}

interface SessionState {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  requestRegistrationCode: (email: string) => Promise<void>;
  register: (args: {
    email: string;
    password: string;
    verificationCode: string;
    nickname: string;
    role: UserRole;
    studentMode: StudentMode;
  }) => Promise<void>;
  requestForgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  restoreSession: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
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
      set({ loading: false });
      await get().refreshMe();
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  requestRegistrationCode: async (email) => {
    await apiClient.post<{ ok: boolean; message?: string }>("/api/auth/register/request-code", { email });
  },
  register: async ({ email, password, verificationCode, nickname, role, studentMode }) => {
    set({ loading: true });
    try {
      const data = await apiClient.post<{ accessToken: string; user: SessionUser }>("/api/auth/register", {
        email,
        password,
        verificationCode,
        nickname,
        role,
        studentMode
      });
      setAccessToken(data.accessToken);
      set({ loading: false });
      await get().refreshMe();
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  requestForgotPassword: async (email) => {
    await apiClient.post<{ ok: boolean; message: string }>("/api/auth/forgot-password", { email });
  },
  resetPassword: async (token, newPassword) => {
    await apiClient.post<{ ok: boolean }>("/api/auth/reset-password", { token, newPassword });
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
  },
  restoreSession: async () => {
    set({ loading: true });
    try {
      await get().refreshMe();
      if (get().user) {
        return;
      }
      const res = await fetch(`${getApiBaseUrl()}/api/auth/refresh`, {
        method: "POST",
        credentials: "include"
      });
      if (res.ok) {
        const data = (await res.json()) as { accessToken?: string };
        if (data.accessToken) {
          setAccessToken(data.accessToken);
          await get().refreshMe();
        }
      }
    } finally {
      set({ loading: false });
    }
  }
}));
