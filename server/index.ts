import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import type { Request, Response } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { config } from "./config.js";
import {
  authRequired,
  clearRefreshCookie,
  readRefreshTokenFromRequest,
  hashPassword,
  hashToken,
  persistRefreshToken,
  randomJoinCode,
  roleGuard,
  rotateRefreshToken,
  setRefreshCookie,
  signAccessToken,
  signRefreshToken,
  signYandexOAuthState,
  verifyYandexOAuthState,
  verifyPassword,
  type AuthenticatedRequest
} from "./auth.js";
import { sendPasswordResetLink, sendRegistrationCode, sendTeacherNewStudentEmail } from "./email.js";
import {
  COURSE_MODULE_HOURS,
  ensureLessonTemplateGuides,
  ensureLessonTemplateSeed,
  registerLmsRoutes
} from "./lms.js";

const app = express();

app.use(cors({ origin: config.appBaseUrl, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

registerLmsRoutes(app);

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const registerCodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "nodly-poc-server" });
});

/** PDF из `public/legal` — отдаём как вложение, чтобы не перехватывалось SPA fallback на фронте. */
app.get("/api/legal/:filename", (req: Request, res: Response) => {
  const filename = String(req.params.filename ?? "");
  if (!/^(privacy-policy|user-agreement)\.pdf$/.test(filename)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const filePath = path.join(process.cwd(), "public", "legal", filename);
  if (!existsSync(filePath)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const downloadName =
    filename === "privacy-policy.pdf" ? "Nodly-privacy-policy.pdf" : "Nodly-user-agreement.pdf";
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache");
  createReadStream(filePath).pipe(res);
});

app.post("/api/auth/register/request-code", registerCodeLimiter, async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    res.status(409).json({ error: "Этот email уже зарегистрирован" });
    return;
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await hashPassword(code);
  const expiresAt = new Date(Date.now() + config.registrationOtpTtlMin * 60 * 1000);
  await prisma.registrationOtp.upsert({
    where: { email },
    create: { email, codeHash, expiresAt },
    update: { codeHash, expiresAt, attempts: 0 }
  });
  try {
    await sendRegistrationCode(email, code);
  } catch (err) {
    await prisma.registrationOtp.deleteMany({ where: { email } });
    res.status(503).json({
      error: err instanceof Error ? err.message : "Не удалось отправить письмо с кодом"
    });
    return;
  }
  res.json({ ok: true, message: "Код отправлен на email" });
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const parsed = z
    .object({
      email: z.string().email(),
      password: z.string().min(8),
      verificationCode: z.string().regex(/^\d{6}$/, "Нужен 6-значный код из письма"),
      nickname: z
        .string()
        .trim()
        .min(3)
        .max(32)
        .regex(/^[a-zA-Z0-9_а-яА-Я-]+$/),
      role: z.enum(["teacher", "student"]).default("student"),
      studentMode: z.enum(["school", "direct"]).default("direct")
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email: rawEmail, password, nickname, role, studentMode, verificationCode } = parsed.data;
  const email = rawEmail.toLowerCase();
  const otp = await prisma.registrationOtp.findUnique({ where: { email } });
  if (!otp || otp.expiresAt.getTime() < Date.now()) {
    res.status(400).json({ error: "Код истёк или не запрошен. Запросите код снова." });
    return;
  }
  if (otp.attempts >= 5) {
    await prisma.registrationOtp.delete({ where: { email } });
    res.status(400).json({ error: "Слишком много попыток. Запросите новый код." });
    return;
  }
  const codeOk = await verifyPassword(verificationCode, otp.codeHash);
  if (!codeOk) {
    await prisma.registrationOtp.update({
      where: { email },
      data: { attempts: { increment: 1 } }
    });
    res.status(400).json({ error: "Неверный код" });
    return;
  }
  await prisma.registrationOtp.delete({ where: { email } });

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    res.status(409).json({ error: "Email already exists" });
    return;
  }
  const nickTaken = await prisma.user.findUnique({ where: { nickname } });
  if (nickTaken) {
    res.status(409).json({ error: "Nickname already exists" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      nickname,
      passwordHash,
      provider: "email",
      role,
      studentMode,
      emailVerifiedAt: new Date()
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
      nickname: user.nickname,
      role: user.role,
      studentMode: user.studentMode
    }
  });
});

app.post("/api/auth/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  res.json({
    ok: true,
    message: "Если аккаунт с таким email есть, мы отправили ссылку для сброса пароля."
  });
  void (async () => {
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash || user.provider !== "email") {
        return;
      }
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      const raw = randomBytes(32).toString("hex");
      const tokenHash = hashToken(raw);
      const expiresAt = new Date(Date.now() + config.passwordResetTtlMin * 60 * 1000);
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt }
      });
      const url = `${config.appBaseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(raw)}`;
      await sendPasswordResetLink(user.email, url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("forgot-password send:", err);
    }
  })();
});

app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
  const parsed = z
    .object({
      token: z.string().min(32),
      newPassword: z.string().min(8)
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const tokenHash = hashToken(parsed.data.token);
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!row || row.expiresAt.getTime() < Date.now()) {
    res.status(400).json({ error: "Ссылка недействительна или истекла" });
    return;
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.delete({ where: { id: row.id } }),
    prisma.refreshToken.deleteMany({ where: { userId: row.userId } })
  ]);
  res.json({ ok: true });
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
      nickname: user.nickname,
      role: user.role,
      studentMode: user.studentMode
    }
  });
});

app.post("/api/auth/refresh", async (req, res) => {
  const oldToken = readRefreshTokenFromRequest(req);
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
  const refresh = readRefreshTokenFromRequest(req);
  if (refresh) {
    const decoded = await rotateRefreshToken(refresh);
    if (decoded) {
      await prisma.refreshToken.deleteMany({ where: { userId: decoded.sub } });
    }
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/yandex/start", (req, res) => {
  if (!config.yandexClientId || !config.yandexRedirectUri) {
    res.status(400).json({ error: "Yandex OAuth is not configured" });
    return;
  }
  const roleRaw = typeof req.query.role === "string" ? req.query.role : "student";
  const modeRaw = typeof req.query.studentMode === "string" ? req.query.studentMode : "direct";
  const roleParsed = z.enum(["teacher", "student"]).safeParse(roleRaw);
  const modeParsed = z.enum(["school", "direct"]).safeParse(modeRaw);
  let role = roleParsed.success ? roleParsed.data : "student";
  let studentMode = modeParsed.success ? modeParsed.data : "direct";
  if (role === "teacher") {
    studentMode = "direct";
  }
  const state = signYandexOAuthState(role, studentMode);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.yandexClientId,
    redirect_uri: config.yandexRedirectUri,
    state
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
    const makeSafeNick = (raw: string) =>
      raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9а-я_-]/gi, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 24);
    const pickUniqueNick = async (baseRaw: string, fallback: string) => {
      let base = makeSafeNick(baseRaw) || makeSafeNick(fallback) || `user_${Date.now().toString(36)}`;
      if (base.length < 3) {
        base = `${base}_nodly`;
      }
      let candidate = base;
      let idx = 1;
      while (await prisma.user.findUnique({ where: { nickname: candidate } })) {
        candidate = `${base}_${idx}`;
        idx += 1;
      }
      return candidate;
    };
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
    const stateRaw = typeof req.query.state === "string" ? req.query.state : "";
    const fromState = verifyYandexOAuthState(stateRaw);
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const nickname = await pickUniqueNick(info.display_name ?? info.real_name ?? email.split("@")[0], info.id);
      const newRole = fromState?.role ?? "student";
      const newStudentMode = fromState?.studentMode ?? "direct";
      user = await prisma.user.create({
        data: {
          email,
          nickname,
          provider: "yandex",
          providerUserId: info.id,
          role: newRole,
          studentMode: newRole === "teacher" ? "direct" : newStudentMode
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
      enrollments: {
        include: {
          classroom: {
            include: {
              school: { select: { id: true, name: true } },
              teacher: { select: { id: true, nickname: true, email: true } }
            }
          }
        }
      },
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
    nickname: user.nickname,
    role: user.role,
    studentMode: user.studentMode,
    isAdmin: user.isAdmin,
    hasPassword: Boolean(user.passwordHash),
    schoolsOwned: user.schoolsOwned,
    enrollments: user.enrollments.map(
      (e: {
        id: string;
        classroomId: string;
        classroom: {
          title: string;
          code: string;
          school: { id: string; name: string };
          teacher: { id: string; nickname: string; email: string };
        };
      }) => ({
        id: e.id,
        classroomId: e.classroomId,
        classroomTitle: e.classroom.title,
        classCode: e.classroom.code,
        schoolName: e.classroom.school.name,
        teacherNickname: e.classroom.teacher.nickname,
        teacherEmail: e.classroom.teacher.email
      })
    ),
    spriteSelection: user.spriteSelection
  });
});

app.patch("/api/me/nickname", authRequired, async (req: AuthenticatedRequest, res) => {
  const parsed = z
    .object({
      nickname: z
        .string()
        .trim()
        .min(3)
        .max(32)
        .regex(/^[a-zA-Z0-9_а-яА-Я-]+$/)
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.session!.sub;
  const current = await prisma.user.findUnique({ where: { id: userId } });
  if (!current) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (current.nickname !== parsed.data.nickname) {
    const duplicate = await prisma.user.findUnique({ where: { nickname: parsed.data.nickname } });
    if (duplicate) {
      res.status(409).json({ error: "Nickname already exists" });
      return;
    }
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: { nickname: parsed.data.nickname }
  });
  res.json({ id: user.id, nickname: user.nickname });
});

app.post("/api/me/delete-account", authRequired, async (req: AuthenticatedRequest, res) => {
  const parsed = z
    .object({
      password: z.string().optional(),
      confirmPhrase: z.string().optional()
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.session!.sub;
  const account = await prisma.user.findUnique({ where: { id: userId } });
  if (!account) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (account.passwordHash) {
    const pwd = parsed.data.password;
    if (!pwd || !(await verifyPassword(pwd, account.passwordHash))) {
      res.status(401).json({ error: "Неверный пароль" });
      return;
    }
  } else {
    const expected = `DELETE ${account.email}`;
    if (parsed.data.confirmPhrase !== expected) {
      res.status(400).json({
        error: "Для аккаунта без пароля введите фразу подтверждения",
        expectedPhrase: expected
      });
      return;
    }
  }
  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({ event: "account_deleted", userId: account.id, at: new Date().toISOString() })
  );
  await prisma.user.delete({ where: { id: userId } });
  clearRefreshCookie(res);
  res.json({ ok: true });
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

app.get("/api/teacher/dashboard", authRequired, roleGuard(["teacher"]), async (req: AuthenticatedRequest, res) => {
  const teacherId = req.session!.sub;
  const [schools, classrooms] = await Promise.all([
    prisma.school.findMany({
      where: { ownerId: teacherId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.classroom.findMany({
      where: { teacherId },
      include: {
        school: { select: { id: true, name: true } },
        enrollments: {
          include: {
            student: { select: { id: true, nickname: true, email: true } }
          },
          orderBy: { joinedAt: "asc" }
        }
      },
      orderBy: { createdAt: "desc" }
    })
  ]);
  res.json({
    schools,
    classrooms: classrooms.map((c) => ({
      id: c.id,
      title: c.title,
      code: c.code,
      schoolId: c.schoolId,
      schoolName: c.school.name,
      courseModule: c.courseModule,
      courseHours: COURSE_MODULE_HOURS[c.courseModule],
      createdAt: c.createdAt.toISOString(),
      students: c.enrollments.map((e) => ({
        enrollmentId: e.id,
        joinedAt: e.joinedAt.toISOString(),
        id: e.student.id,
        nickname: e.student.nickname,
        email: e.student.email
      }))
    }))
  });
});

app.post(
  "/api/classrooms",
  authRequired,
  roleGuard(["teacher"]),
  async (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        schoolId: z.string(),
        title: z.string().min(2),
        courseModule: z.enum(["A", "B", "C", "D"]).optional()
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const courseModule = parsed.data.courseModule ?? "A";
    if (courseModule !== "A") {
      res.status(400).json({ error: "Пока доступен только модуль A (8 часов)" });
      return;
    }
    const school = await prisma.school.findFirst({
      where: { id: parsed.data.schoolId, ownerId: req.session!.sub }
    });
    if (!school) {
      res.status(403).json({ error: "Школа не найдена или нет доступа" });
      return;
    }
    const code = randomJoinCode();
    const classroom = await prisma.classroom.create({
      data: {
        schoolId: parsed.data.schoolId,
        teacherId: req.session!.sub,
        title: parsed.data.title,
        code,
        courseModule
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

app.delete(
  "/api/teacher/classrooms/:classroomId",
  authRequired,
  roleGuard(["teacher"]),
  async (req: AuthenticatedRequest, res) => {
    const classroomId = String(req.params.classroomId);
    const c = await prisma.classroom.findFirst({
      where: { id: classroomId, teacherId: req.session!.sub }
    });
    if (!c) {
      res.status(404).json({ error: "Класс не найден" });
      return;
    }
    await prisma.classroom.delete({ where: { id: classroomId } });
    res.json({ ok: true });
  }
);

app.delete(
  "/api/teacher/classrooms/:classroomId/enrollments/:enrollmentId",
  authRequired,
  roleGuard(["teacher"]),
  async (req: AuthenticatedRequest, res) => {
    const classroomId = String(req.params.classroomId);
    const enrollmentId = String(req.params.enrollmentId);
    const enrollment = await prisma.enrollment.findFirst({
      where: { id: enrollmentId, classroomId },
      include: { classroom: { select: { teacherId: true } } }
    });
    if (!enrollment || enrollment.classroom.teacherId !== req.session!.sub) {
      res.status(404).json({ error: "Не найдено" });
      return;
    }
    const assignments = await prisma.assignment.findMany({
      where: { classroomId },
      select: { id: true }
    });
    const assignmentIds = assignments.map((a) => a.id);
    await prisma.$transaction([
      prisma.submission.deleteMany({
        where: {
          studentId: enrollment.studentId,
          assignmentId: { in: assignmentIds }
        }
      }),
      prisma.enrollment.delete({ where: { id: enrollmentId } })
    ]);
    res.json({ ok: true });
  }
);

app.post("/api/classrooms/join", authRequired, roleGuard(["student"]), async (req: AuthenticatedRequest, res) => {
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
  const existedEnrollment = await prisma.enrollment.findUnique({
    where: {
      classroomId_studentId: {
        classroomId: invite.classroomId,
        studentId: req.session!.sub
      }
    }
  });
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
  if (!existedEnrollment) {
    const [room, stud] = await Promise.all([
      prisma.classroom.findUnique({
        where: { id: invite.classroomId },
        include: { teacher: { select: { email: true } } }
      }),
      prisma.user.findUnique({ where: { id: req.session!.sub }, select: { nickname: true } })
    ]);
    if (room?.teacher?.email && stud) {
      const appUrl = `${config.appBaseUrl.replace(/\/$/, "")}/teacher`;
      void sendTeacherNewStudentEmail(room.teacher.email, {
        studentNickname: stud.nickname,
        classTitle: room.title,
        appUrl
      }).catch(() => {});
    }
  }
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
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      lessonTemplateId: true,
      catalogLessonComplete: true
    }
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
      snapshot: z.record(z.string(), z.unknown()),
      lessonTemplateId: z.string().nullable().optional(),
      catalogLessonComplete: z.boolean().optional()
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const createData: Prisma.ProjectCreateInput = {
    id: projectId,
    title: parsed.data.title,
    user: { connect: { id: req.session!.sub } },
    snapshot: { create: { payload: parsed.data.snapshot as Prisma.InputJsonValue } },
    ...(parsed.data.lessonTemplateId
      ? { lessonTemplate: { connect: { id: parsed.data.lessonTemplateId } } }
      : {}),
    ...(parsed.data.catalogLessonComplete !== undefined
      ? { catalogLessonComplete: parsed.data.catalogLessonComplete }
      : {})
  };
  const updateData: Prisma.ProjectUpdateInput = {
    title: parsed.data.title,
    snapshot: {
      upsert: {
        create: { payload: parsed.data.snapshot as Prisma.InputJsonValue },
        update: { payload: parsed.data.snapshot as Prisma.InputJsonValue }
      }
    }
  };
  if (parsed.data.lessonTemplateId !== undefined) {
    updateData.lessonTemplate =
      parsed.data.lessonTemplateId === null
        ? { disconnect: true }
        : { connect: { id: parsed.data.lessonTemplateId } };
  }
  if (parsed.data.catalogLessonComplete !== undefined) {
    updateData.catalogLessonComplete = parsed.data.catalogLessonComplete;
  }
  const project = await prisma.project.upsert({
    where: { id: projectId },
    create: createData,
    update: updateData,
    include: { snapshot: true }
  });
  res.json({
    id: project.id,
    title: project.title,
    updatedAt: project.updatedAt.toISOString()
  });
});

app.patch("/api/projects/:id/catalog-lesson", authRequired, async (req: AuthenticatedRequest, res) => {
  const projectId = String(req.params.id);
  const parsed = z.object({ catalogLessonComplete: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await prisma.project.findFirst({
    where: { id: projectId, userId: req.session!.sub },
    select: { id: true }
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { catalogLessonComplete: parsed.data.catalogLessonComplete }
  });
  res.json({
    id: updated.id,
    catalogLessonComplete: updated.catalogLessonComplete,
    updatedAt: updated.updatedAt.toISOString()
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
  try {
    await ensureLessonTemplateSeed();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Lesson template seed skipped:", error);
  }
  try {
    await ensureLessonTemplateGuides();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Lesson template guides skipped:", error);
  }
  // eslint-disable-next-line no-console
  console.log(`Server started at http://localhost:${config.port}`);
});
