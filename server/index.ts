import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import type { Request, Response } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { config } from "./config.js";
import {
  authRequired,
  clearRefreshCookie,
  hashPassword,
  persistRefreshToken,
  randomJoinCode,
  roleGuard,
  rotateRefreshToken,
  setRefreshCookie,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  type AuthenticatedRequest
} from "./auth.js";

const app = express();

app.use(cors({ origin: config.appBaseUrl, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "noda-poc-server" });
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const parsed = z
    .object({
      email: z.string().email(),
      password: z.string().min(8),
      role: z.enum(["teacher", "student"]).default("student"),
      displayName: z.string().trim().min(1).optional(),
      studentMode: z.enum(["school", "direct"]).default("direct")
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, password, role, displayName, studentMode } = parsed.data;
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    res.status(409).json({ error: "Email already exists" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      provider: "email",
      role,
      displayName,
      studentMode
    }
  });
  const payload = { sub: user.id, role: user.role };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  await persistRefreshToken(user.id, refreshToken);
  setRefreshCookie(res, refreshToken);
  res.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      studentMode: user.studentMode,
      displayName: user.displayName
    }
  });
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const parsed = z
    .object({
      email: z.string().email(),
      password: z.string().min(8)
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user?.passwordHash) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const payload = { sub: user.id, role: user.role };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  await persistRefreshToken(user.id, refreshToken);
  setRefreshCookie(res, refreshToken);
  res.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      studentMode: user.studentMode,
      displayName: user.displayName
    }
  });
});

app.post("/api/auth/refresh", async (req, res) => {
  const oldToken = req.cookies?.noda_refresh as string | undefined;
  const decoded = await rotateRefreshToken(oldToken);
  if (!decoded) {
    clearRefreshCookie(res);
    res.status(401).json({ error: "Invalid refresh token" });
    return;
  }
  const newAccess = signAccessToken(decoded);
  const newRefresh = signRefreshToken(decoded);
  await persistRefreshToken(decoded.sub, newRefresh);
  setRefreshCookie(res, newRefresh);
  res.json({ accessToken: newAccess });
});

app.post("/api/auth/logout", async (req, res) => {
  const refresh = req.cookies?.noda_refresh as string | undefined;
  if (refresh) {
    const decoded = await rotateRefreshToken(refresh);
    if (decoded) {
      await prisma.refreshToken.deleteMany({ where: { userId: decoded.sub } });
    }
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/yandex/start", (_req, res) => {
  if (!config.yandexClientId || !config.yandexRedirectUri) {
    res.status(400).json({ error: "Yandex OAuth is not configured" });
    return;
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.yandexClientId,
    redirect_uri: config.yandexRedirectUri
  });
  res.redirect(`https://oauth.yandex.ru/authorize?${params.toString()}`);
});

app.get("/api/auth/yandex/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  if (!code || !config.yandexClientId || !config.yandexClientSecret) {
    res.status(400).json({ error: "Invalid OAuth callback" });
    return;
  }
  try {
    const tokenResp = await fetch("https://oauth.yandex.ru/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: config.yandexClientId,
        client_secret: config.yandexClientSecret
      }).toString()
    });
    const tokenJson = (await tokenResp.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      throw new Error("Missing access token");
    }
    const infoResp = await fetch("https://login.yandex.ru/info?format=json", {
      headers: { Authorization: `OAuth ${tokenJson.access_token}` }
    });
    const info = (await infoResp.json()) as {
      id: string;
      default_email?: string;
      real_name?: string;
      display_name?: string;
    };
    const email = info.default_email ?? `${info.id}@yandex.local`;
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          provider: "yandex",
          providerUserId: info.id,
          role: "student",
          studentMode: "direct",
          displayName: info.real_name ?? info.display_name ?? email
        }
      });
    }
    const payload = { sub: user.id, role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    await persistRefreshToken(user.id, refreshToken);
    setRefreshCookie(res, refreshToken);
    res.redirect(`${config.appBaseUrl}?access_token=${accessToken}`);
  } catch {
    res.status(500).json({ error: "OAuth failed" });
  }
});

app.get("/api/me", authRequired, async (req: AuthenticatedRequest, res) => {
  const userId = req.session!.sub;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      enrollments: { include: { classroom: true } },
      schoolsOwned: true,
      spriteSelection: { include: { character: true, spritePack: true } }
    }
  });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    studentMode: user.studentMode,
    displayName: user.displayName,
    schoolsOwned: user.schoolsOwned,
    enrollments: user.enrollments.map((e: { id: string; classroomId: string; classroom: { title: string } }) => ({
      id: e.id,
      classroomId: e.classroomId,
      classroomTitle: e.classroom.title
    })),
    spriteSelection: user.spriteSelection
  });
});

app.post("/api/schools", authRequired, roleGuard(["teacher"]), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ name: z.string().min(2) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const school = await prisma.school.create({
    data: { name: parsed.data.name, ownerId: req.session!.sub }
  });
  res.json(school);
});

app.post(
  "/api/classrooms",
  authRequired,
  roleGuard(["teacher"]),
  async (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ schoolId: z.string(), title: z.string().min(2) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const code = randomJoinCode();
    const classroom = await prisma.classroom.create({
      data: {
        schoolId: parsed.data.schoolId,
        teacherId: req.session!.sub,
        title: parsed.data.title,
        code
      }
    });
    await prisma.inviteCode.create({
      data: {
        classroomId: classroom.id,
        code
      }
    });
    res.json(classroom);
  }
);

app.post("/api/classrooms/join", authRequired, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ code: z.string().min(4) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const invite = await prisma.inviteCode.findFirst({
    where: { code: parsed.data.code.toUpperCase(), active: true },
    include: { classroom: true }
  });
  if (!invite) {
    res.status(404).json({ error: "Invite code not found" });
    return;
  }
  const enrollment = await prisma.enrollment.upsert({
    where: {
      classroomId_studentId: {
        classroomId: invite.classroomId,
        studentId: req.session!.sub
      }
    },
    create: { classroomId: invite.classroomId, studentId: req.session!.sub },
    update: {}
  });
  await prisma.user.update({
    where: { id: req.session!.sub },
    data: { studentMode: "school" }
  });
  res.json({ enrollmentId: enrollment.id, classroom: invite.classroom });
});

app.post("/api/analytics/events", authRequired, async (req: AuthenticatedRequest, res) => {
  const parsed = z
    .object({
      events: z.array(
        z.object({
          name: z.string().min(1),
          payload: z.record(z.string(), z.unknown()).optional()
        })
      )
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.session!.sub;
  if (parsed.data.events.length === 0) {
    res.json({ ok: true });
    return;
  }
  await prisma.analyticsEvent.createMany({
    data: parsed.data.events.map((event) => ({
      userId,
      name: event.name,
      payload: (event.payload ?? undefined) as Prisma.InputJsonValue | undefined
    }))
  });
  const runEvents = parsed.data.events.filter((e) =>
    ["training_started", "training_completed", "prediction_run"].includes(e.name)
  );
  if (runEvents.length > 0) {
    await prisma.modelRunStat.upsert({
      where: { id: `aggregate_${userId}` },
      create: {
        id: `aggregate_${userId}`,
        userId,
        modelType: "mixed",
        runs: runEvents.length,
        trainCount: runEvents.filter((e) => e.name !== "prediction_run").length,
        predictCount: runEvents.filter((e) => e.name === "prediction_run").length
      },
      update: {
        runs: { increment: runEvents.length },
        trainCount: { increment: runEvents.filter((e) => e.name !== "prediction_run").length },
        predictCount: { increment: runEvents.filter((e) => e.name === "prediction_run").length }
      }
    });
  }
  res.json({ ok: true, accepted: parsed.data.events.length });
});

app.get("/api/sprites", authRequired, async (_req, res) => {
  const [characters, packs] = await Promise.all([
    prisma.avatarCharacter.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.spritePack.findMany({ orderBy: { createdAt: "asc" } })
  ]);
  res.json({ characters, packs });
});

app.post("/api/me/sprite", authRequired, async (req: AuthenticatedRequest, res) => {
  const parsed = z
    .object({
      characterId: z.string().optional(),
      spritePackId: z.string().optional()
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const selection = await prisma.userSpriteSelection.upsert({
    where: { userId: req.session!.sub },
    create: {
      userId: req.session!.sub,
      characterId: parsed.data.characterId,
      spritePackId: parsed.data.spritePackId
    },
    update: {
      characterId: parsed.data.characterId,
      spritePackId: parsed.data.spritePackId
    },
    include: { character: true, spritePack: true }
  });
  res.json(selection);
});

app.get("/api/projects", authRequired, async (req: AuthenticatedRequest, res) => {
  const projects = await prisma.project.findMany({
    where: { userId: req.session!.sub },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true }
  });
  res.json(projects);
});

app.get("/api/projects/:id", authRequired, async (req: AuthenticatedRequest, res) => {
  const projectId = String(req.params.id);
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: req.session!.sub },
    include: { snapshot: true }
  });
  if (!project?.snapshot) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({
    meta: {
      id: project.id,
      userId: project.userId,
      title: project.title,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString()
    },
    snapshot: project.snapshot.payload
  });
});

app.put("/api/projects/:id", authRequired, async (req: AuthenticatedRequest, res) => {
  const projectId = String(req.params.id);
  const parsed = z
    .object({
      title: z.string().min(1),
      snapshot: z.record(z.string(), z.unknown())
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const project = await prisma.project.upsert({
    where: { id: projectId },
    create: {
      id: projectId,
      userId: req.session!.sub,
      title: parsed.data.title,
      snapshot: { create: { payload: parsed.data.snapshot as Prisma.InputJsonValue } }
    },
    update: {
      title: parsed.data.title,
      snapshot: {
        upsert: {
          create: { payload: parsed.data.snapshot as Prisma.InputJsonValue },
          update: { payload: parsed.data.snapshot as Prisma.InputJsonValue }
        }
      }
    },
    include: { snapshot: true }
  });
  res.json({
    id: project.id,
    title: project.title,
    updatedAt: project.updatedAt.toISOString()
  });
});

async function ensureSpriteSeed() {
  const packsCount = await prisma.spritePack.count();
  if (packsCount === 0) {
    await prisma.spritePack.createMany({
      data: [
        { key: "classic_dog", title: "Робо-пёс Classic" },
        { key: "neon_dog", title: "Робо-пёс Neon" },
        { key: "minimal_bot", title: "Мини-бот" }
      ]
    });
  }
  const charsCount = await prisma.avatarCharacter.count();
  if (charsCount === 0) {
    await prisma.avatarCharacter.createMany({
      data: [
        { key: "dog", title: "Робо-пёс" },
        { key: "cat", title: "Кибер-кот" },
        { key: "owl", title: "ИИ-сова" }
      ]
    });
  }
}

app.listen(config.port, async () => {
  try {
    await ensureSpriteSeed();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Sprite seed skipped:", error);
  }
  // eslint-disable-next-line no-console
  console.log(`Server started at http://localhost:${config.port}`);
});
