import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { StudentMode, UserRole } from "@prisma/client";
import { prisma } from "./db.js";
import { config } from "./config.js";

export interface SessionPayload {
  sub: string;
  role: UserRole;
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload: SessionPayload) {
  return jwt.sign(payload, config.jwtAccessSecret, { expiresIn: config.accessTokenTtlSec });
}

export function signRefreshToken(payload: SessionPayload) {
  return jwt.sign(payload, config.jwtRefreshSecret, { expiresIn: config.refreshTokenTtlSec });
}

const YANDEX_OAUTH_STATE_TYP = "yandex_oauth";

/** Подписанный state для OAuth Яндекса: роль и режим ученика при первом создании пользователя. */
export function signYandexOAuthState(role: "teacher" | "student", studentMode: StudentMode): string {
  const mode: StudentMode = role === "teacher" ? "direct" : studentMode;
  return jwt.sign(
    { typ: YANDEX_OAUTH_STATE_TYP, role, studentMode: mode },
    config.jwtAccessSecret,
    { expiresIn: "1h" }
  );
}

export function verifyYandexOAuthState(
  token: string
): { role: "teacher" | "student"; studentMode: StudentMode } | null {
  try {
    const decoded = jwt.verify(token, config.jwtAccessSecret) as {
      typ?: string;
      role?: UserRole;
      studentMode?: StudentMode;
    };
    if (decoded.typ !== YANDEX_OAUTH_STATE_TYP) {
      return null;
    }
    if (decoded.role !== "teacher" && decoded.role !== "student") {
      return null;
    }
    if (decoded.studentMode !== "school" && decoded.studentMode !== "direct") {
      return null;
    }
    return {
      role: decoded.role,
      studentMode: decoded.role === "teacher" ? "direct" : decoded.studentMode
    };
  } catch {
    return null;
  }
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function persistRefreshToken(userId: string, refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlSec * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt }
  });
}

const refreshCookieOpts = {
  path: "/api/auth",
  sameSite: config.cookieSameSite,
  secure: config.cookieSecure
} as const;

export function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie("nodly_refresh", refreshToken, {
    httpOnly: true,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    path: "/api/auth",
    maxAge: config.refreshTokenTtlSec * 1000
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie("nodly_refresh", refreshCookieOpts);
  res.clearCookie("noda_refresh", refreshCookieOpts);
}

export function readRefreshTokenFromRequest(req: Request): string | undefined {
  const c = req.cookies as Record<string, string | undefined> | undefined;
  return c?.nodly_refresh ?? c?.noda_refresh;
}

export async function rotateRefreshToken(oldToken: string | undefined) {
  if (!oldToken) {
    return null;
  }
  try {
    const decoded = jwt.verify(oldToken, config.jwtRefreshSecret) as SessionPayload;
    const stored = await prisma.refreshToken.findFirst({
      where: { userId: decoded.sub, tokenHash: hashToken(oldToken) }
    });
    if (!stored || stored.expiresAt.getTime() < Date.now()) {
      return null;
    }
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    return decoded;
  } catch {
    return null;
  }
}

export function randomJoinCode() {
  return randomBytes(3).toString("hex").toUpperCase();
}

export interface AuthenticatedRequest extends Request {
  session?: SessionPayload;
}

export function authRequired(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const raw = req.headers.authorization;
  const token = raw?.startsWith("Bearer ") ? raw.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    req.session = jwt.verify(token, config.jwtAccessSecret) as SessionPayload;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function roleGuard(roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const role = req.session?.role;
    if (!role || !roles.includes(role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

export async function adminRequired(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.session?.sub;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });
    if (row?.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    next();
  } catch {
    res.status(500).json({ error: "Server error" });
  }
}

