import type { Express } from "express";
import { randomBytes, randomUUID } from "crypto";
import { z } from "zod";
import { Prisma, type CourseModule } from "@prisma/client";
import { prisma } from "./db.js";
import { config } from "./config.js";
import {
  sendStudentGradedEmail,
  sendStudentNewAssignmentEmail,
  sendTeacherSubmissionEmail
} from "./email.js";
import {
  adminRequired,
  authRequired,
  roleGuard,
  type AuthenticatedRequest
} from "./auth.js";

async function notifyEnrolledStudentsNewAssignment(classroomId: string, assignmentTitle: string) {
  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: {
      title: true,
      enrollments: { select: { student: { select: { email: true } } } }
    }
  });
  if (!classroom) {
    return;
  }
  const appUrl = `${config.appBaseUrl.replace(/\/$/, "")}/class`;
  for (const e of classroom.enrollments) {
    void sendStudentNewAssignmentEmail(e.student.email, {
      assignmentTitle,
      classTitle: classroom.title,
      appUrl
    }).catch(() => {
      /* письмо опционально в PoC */
    });
  }
}

const EMPTY_SNAPSHOT: Prisma.InputJsonValue = {
  imageDatasets: [],
  tabularDatasets: [],
  imagePredictionInputs: [],
  tabularPredictionInputs: [],
  savedModels: [],
  blocklyState: ""
};

function toMinutePrecisionStart(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error("invalid startsAt");
  }
  d.setSeconds(0, 0);
  return d;
}

function computeEndsAtFromDuration(start: Date, durationMinutes: number): Date {
  return new Date(start.getTime() + durationMinutes * 60 * 1000);
}

function clampDurationMinutes(raw: number): number {
  return Math.max(5, Math.min(12 * 60, Math.round(raw)));
}

function resolveDurationMinutes(
  startsAt: Date,
  body: { durationMinutes?: number | null; endsAt?: string | null }
): number {
  if (body.durationMinutes != null && !Number.isNaN(body.durationMinutes)) {
    return clampDurationMinutes(body.durationMinutes);
  }
  if (body.endsAt) {
    const end = new Date(body.endsAt);
    if (!Number.isNaN(end.getTime())) {
      return clampDurationMinutes((end.getTime() - startsAt.getTime()) / 60_000);
    }
  }
  return 90;
}

/** Допуск по часам клиента/сервера при проверке «не в прошлом» */
const SCHEDULE_PAST_GRACE_MS = 90_000;

function scheduleStartInPastError(): string {
  return "Нельзя ставить занятие в прошлом";
}

function assertScheduleStartNotInPast(startsAt: Date): string | null {
  if (startsAt.getTime() < Date.now() - SCHEDULE_PAST_GRACE_MS) {
    return scheduleStartInPastError();
  }
  return null;
}

function assertDueAtInFuture(dueAt: Date): string | null {
  if (dueAt.getTime() <= Date.now()) {
    return "Срок сдачи не может быть в прошлом";
  }
  return null;
}

export const COURSE_MODULE_HOURS: Record<CourseModule, number> = {
  A: 8,
  B: 24,
  C: 48,
  D: 72
};

export function courseModuleToModuleKey(m: CourseModule): string {
  const map: Record<CourseModule, string> = {
    A: "module_a",
    B: "module_b",
    C: "module_c",
    D: "module_d"
  };
  return map[m];
}

const assignmentKindZ = z.enum(["classwork", "homework", "project"]);

async function assertTeacherClassroom(teacherId: string, classroomId: string) {
  const c = await prisma.classroom.findFirst({
    where: { id: classroomId, teacherId }
  });
  return c;
}

async function assertStudentInClassroom(studentId: string, classroomId: string) {
  return prisma.enrollment.findUnique({
    where: { classroomId_studentId: { classroomId, studentId } }
  });
}

export function registerLmsRoutes(app: Express) {
  app.get("/api/me/summary", authRequired, async (req: AuthenticatedRequest, res) => {
    const userId = req.session!.sub;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, studentMode: true }
    });
    if (!user) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (user.role === "teacher") {
      const classrooms = await prisma.classroom.findMany({
        where: { teacherId: userId },
        select: { id: true }
      });
      const ids = classrooms.map((c) => c.id);
      const [pendingReview, newEnrollmentCount] = await Promise.all([
        prisma.submission.count({
          where: {
            status: "submitted",
            teacherSeenAt: null,
            assignment: { classroomId: { in: ids } }
          }
        }),
        prisma.enrollment.count({
          where: {
            teacherSeenJoinAt: null,
            classroomId: { in: ids }
          }
        })
      ]);
      res.json({ pendingReviewCount: pendingReview, newEnrollmentCount });
      return;
    }
    if (user.role === "student" && user.studentMode === "school") {
      const attention = await prisma.submission.count({
        where: {
          studentId: userId,
          OR: [
            { status: "graded", gradedSeenAt: null },
            { status: "needs_revision" }
          ]
        }
      });
      res.json({ assignmentAttentionCount: attention });
      return;
    }
    res.json({});
  });

  app.get("/api/me/schedule-preview", authRequired, async (req: AuthenticatedRequest, res) => {
    const userId = req.session!.sub;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, studentMode: true }
    });
    if (!user) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    let classroomIds: string[] = [];
    if (user.role === "teacher") {
      const cls = await prisma.classroom.findMany({
        where: { teacherId: userId },
        select: { id: true }
      });
      classroomIds = cls.map((c) => c.id);
    } else if (user.role === "student" && user.studentMode === "school") {
      const en = await prisma.enrollment.findMany({
        where: { studentId: userId },
        select: { classroomId: true }
      });
      classroomIds = en.map((e) => e.classroomId);
    } else {
      res.json({ slots: [] });
      return;
    }
    if (classroomIds.length === 0) {
      res.json({ slots: [] });
      return;
    }
    const horizonStart = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const horizonEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const slots = await prisma.classScheduleSlot.findMany({
      where: {
        classroomId: { in: classroomIds },
        startsAt: { gte: horizonStart, lte: horizonEnd }
      },
      orderBy: { startsAt: "asc" },
      include: {
        lessonTemplate: { select: { title: true } },
        classroom: { select: { title: true } }
      }
    });
    res.json({
      slots: slots.map((s) => ({
        id: s.id,
        startsAt: s.startsAt.toISOString(),
        durationMinutes: s.durationMinutes,
        lessonTitle: s.lessonTemplate?.title ?? null,
        notes: s.notes,
        classroomTitle: s.classroom.title,
        classroomId: s.classroomId
      }))
    });
  });

  app.get("/api/lesson-templates", async (_req, res) => {
    const list = await prisma.lessonTemplate.findMany({
      where: { published: true },
      orderBy: [{ moduleKey: "asc" }, { sortOrder: "asc" }]
    });
    res.json(
      list.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        moduleKey: t.moduleKey,
        sortOrder: t.sortOrder
      }))
    );
  });

  app.get("/api/lesson-templates/:id/starter", async (req, res) => {
    const t = await prisma.lessonTemplate.findFirst({
      where: { id: String(req.params.id), published: true }
    });
    if (!t) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ starterPayload: t.starterPayload });
  });

  app.get(
    "/api/teacher/classrooms/:classroomId/course",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const classroomId = String(req.params.classroomId);
      const c = await prisma.classroom.findFirst({
        where: { id: classroomId, teacherId: req.session!.sub },
        select: { courseModule: true }
      });
      if (!c) {
        res.status(404).json({ error: "Class not found" });
        return;
      }
      const moduleKey = courseModuleToModuleKey(c.courseModule);
      const lessons = await prisma.lessonTemplate.findMany({
        where: { published: true, moduleKey },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          moduleKey: true,
          sortOrder: true,
          teacherGuideMd: true,
          studentSummary: true
        }
      });
      res.json({
        courseModule: c.courseModule,
        courseHours: COURSE_MODULE_HOURS[c.courseModule],
        lessons
      });
    }
  );

  app.get(
    "/api/student/classrooms/:classroomId/course",
    authRequired,
    roleGuard(["student"]),
    async (req: AuthenticatedRequest, res) => {
      const classroomId = String(req.params.classroomId);
      const ok = await assertStudentInClassroom(req.session!.sub, classroomId);
      if (!ok) {
        res.status(404).json({ error: "Class not found" });
        return;
      }
      const c = await prisma.classroom.findUnique({
        where: { id: classroomId },
        select: { courseModule: true }
      });
      if (!c) {
        res.status(404).json({ error: "Class not found" });
        return;
      }
      const moduleKey = courseModuleToModuleKey(c.courseModule);
      const lessons = await prisma.lessonTemplate.findMany({
        where: { published: true, moduleKey },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          moduleKey: true,
          sortOrder: true,
          studentSummary: true
        }
      });
      res.json({
        courseModule: c.courseModule,
        courseHours: COURSE_MODULE_HOURS[c.courseModule],
        lessons
      });
    }
  );

  app.get(
    "/api/teacher/classrooms/:classroomId/schedule",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const classroomId = String(req.params.classroomId);
      const c = await assertTeacherClassroom(req.session!.sub, classroomId);
      if (!c) {
        res.status(404).json({ error: "Class not found" });
        return;
      }
      const slots = await prisma.classScheduleSlot.findMany({
        where: { classroomId },
        orderBy: { startsAt: "asc" },
        include: {
          lessonTemplate: { select: { id: true, title: true } }
        }
      });
      res.json(
        slots.map((s) => {
          const endsAt = s.endsAt ?? computeEndsAtFromDuration(s.startsAt, s.durationMinutes);
          return {
            id: s.id,
            startsAt: s.startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            durationMinutes: s.durationMinutes,
            notes: s.notes,
            lessonTemplateId: s.lessonTemplateId,
            lessonTitle: s.lessonTemplate?.title ?? null,
            weeklySeriesId: s.weeklySeriesId
          };
        })
      );
    }
  );

  app.post(
    "/api/teacher/classrooms/:classroomId/schedule",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const classroomId = String(req.params.classroomId);
      const c = await assertTeacherClassroom(req.session!.sub, classroomId);
      if (!c) {
        res.status(404).json({ error: "Class not found" });
        return;
      }
      const parsed = z
        .object({
          startsAt: z.string().datetime(),
          durationMinutes: z.coerce.number().int().optional().nullable(),
          endsAt: z.string().datetime().optional().nullable(),
          lessonTemplateId: z.string().optional().nullable(),
          notes: z.string().optional().nullable(),
          repeatWeeks: z.coerce.number().int().min(1).max(52).optional()
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      let startsAt: Date;
      try {
        startsAt = toMinutePrecisionStart(parsed.data.startsAt);
      } catch {
        res.status(400).json({ error: "Некорректное время начала" });
        return;
      }
      const pastErr = assertScheduleStartNotInPast(startsAt);
      if (pastErr) {
        res.status(400).json({ error: pastErr });
        return;
      }
      const durationMinutes = resolveDurationMinutes(startsAt, parsed.data);
      const moduleKey = courseModuleToModuleKey(c.courseModule);
      if (parsed.data.lessonTemplateId) {
        const lt = await prisma.lessonTemplate.findFirst({
          where: { id: parsed.data.lessonTemplateId, published: true, moduleKey }
        });
        if (!lt) {
          res.status(400).json({ error: "Урок не из программы этого класса" });
          return;
        }
      }
      const repeatWeeks = Math.min(52, Math.max(1, parsed.data.repeatWeeks ?? 1));
      const weeklySeriesId = repeatWeeks > 1 ? randomUUID() : null;
      const lessonTemplateId = parsed.data.lessonTemplateId ?? null;
      const notes = parsed.data.notes ?? null;
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const batch = [];
      for (let w = 0; w < repeatWeeks; w++) {
        const wStart = new Date(startsAt.getTime() + w * weekMs);
        const wPast = assertScheduleStartNotInPast(wStart);
        if (wPast) {
          res.status(400).json({ error: wPast });
          return;
        }
        batch.push({
          id: randomUUID(),
          classroomId,
          startsAt: wStart,
          endsAt: computeEndsAtFromDuration(wStart, durationMinutes),
          durationMinutes,
          lessonTemplateId,
          notes,
          weeklySeriesId
        });
      }
      await prisma.classScheduleSlot.createMany({ data: batch });
      res.json({
        ids: batch.map((b) => b.id),
        weeklySeriesId,
        count: batch.length
      });
    }
  );

  app.patch(
    "/api/teacher/schedule-slots/:slotId",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const slotId = String(req.params.slotId);
      const slot = await prisma.classScheduleSlot.findUnique({
        where: { id: slotId },
        include: { classroom: { select: { teacherId: true, courseModule: true, id: true } } }
      });
      if (!slot || slot.classroom.teacherId !== req.session!.sub) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const parsed = z
        .object({
          startsAt: z.string().datetime().optional(),
          durationMinutes: z.coerce.number().int().optional().nullable(),
          endsAt: z.string().datetime().optional().nullable(),
          lessonTemplateId: z.string().optional().nullable(),
          notes: z.string().optional().nullable()
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const moduleKey = courseModuleToModuleKey(slot.classroom.courseModule);
      if (parsed.data.lessonTemplateId) {
        const lt = await prisma.lessonTemplate.findFirst({
          where: { id: parsed.data.lessonTemplateId, published: true, moduleKey }
        });
        if (!lt) {
          res.status(400).json({ error: "Урок не из программы этого класса" });
          return;
        }
      }
      let nextStart = slot.startsAt;
      if (parsed.data.startsAt !== undefined) {
        try {
          nextStart = toMinutePrecisionStart(parsed.data.startsAt);
        } catch {
          res.status(400).json({ error: "Некорректное время начала" });
          return;
        }
      }
      let durationMinutes = slot.durationMinutes;
      if (parsed.data.durationMinutes != null && !Number.isNaN(parsed.data.durationMinutes)) {
        durationMinutes = clampDurationMinutes(parsed.data.durationMinutes);
      } else if (parsed.data.endsAt) {
        const end = new Date(parsed.data.endsAt);
        if (!Number.isNaN(end.getTime())) {
          durationMinutes = clampDurationMinutes((end.getTime() - nextStart.getTime()) / 60_000);
        }
      }
      const timeFieldsChanged =
        parsed.data.startsAt !== undefined ||
        (parsed.data.durationMinutes != null && !Number.isNaN(parsed.data.durationMinutes)) ||
        Boolean(parsed.data.endsAt);
      if (parsed.data.startsAt !== undefined) {
        const pastErr = assertScheduleStartNotInPast(nextStart);
        if (pastErr) {
          res.status(400).json({ error: pastErr });
          return;
        }
      }
      const endsAt = computeEndsAtFromDuration(nextStart, durationMinutes);
      const updated = await prisma.classScheduleSlot.update({
        where: { id: slotId },
        data: {
          ...(parsed.data.startsAt !== undefined ? { startsAt: nextStart } : {}),
          ...(timeFieldsChanged ? { durationMinutes, endsAt } : {}),
          ...(parsed.data.lessonTemplateId !== undefined
            ? { lessonTemplateId: parsed.data.lessonTemplateId }
            : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {})
        }
      });
      res.json({ id: updated.id });
    }
  );

  app.delete(
    "/api/teacher/schedule-slots/:slotId",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const slotId = String(req.params.slotId);
      const slot = await prisma.classScheduleSlot.findUnique({
        where: { id: slotId },
        include: { classroom: { select: { teacherId: true } } }
      });
      if (!slot || slot.classroom.teacherId !== req.session!.sub) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      await prisma.classScheduleSlot.delete({ where: { id: slotId } });
      res.json({ ok: true });
    }
  );

  app.delete(
    "/api/teacher/schedule-series/:seriesId",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const seriesId = String(req.params.seriesId);
      if (!seriesId) {
        res.status(400).json({ error: "seriesId required" });
        return;
      }
      const slots = await prisma.classScheduleSlot.findMany({
        where: { weeklySeriesId: seriesId },
        include: { classroom: { select: { teacherId: true } } }
      });
      if (slots.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (slots.some((s) => s.classroom.teacherId !== req.session!.sub)) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      await prisma.classScheduleSlot.deleteMany({ where: { weeklySeriesId: seriesId } });
      res.json({ ok: true, deleted: slots.length });
    }
  );

  app.get(
    "/api/student/classrooms/:classroomId/schedule",
    authRequired,
    roleGuard(["student"]),
    async (req: AuthenticatedRequest, res) => {
      const classroomId = String(req.params.classroomId);
      const ok = await assertStudentInClassroom(req.session!.sub, classroomId);
      if (!ok) {
        res.status(404).json({ error: "Class not found" });
        return;
      }
      const slots = await prisma.classScheduleSlot.findMany({
        where: { classroomId },
        orderBy: { startsAt: "asc" },
        include: {
          lessonTemplate: { select: { id: true, title: true } }
        }
      });
      const studentId = req.session!.sub;
      const attendances = await prisma.scheduleSlotAttendance.findMany({
        where: { studentId, slotId: { in: slots.map((s) => s.id) } }
      });
      const attBySlot = new Map(attendances.map((a) => [a.slotId, a.plansToAttend]));
      res.json(
        slots.map((s) => {
          const endsAt = s.endsAt ?? computeEndsAtFromDuration(s.startsAt, s.durationMinutes);
          return {
            id: s.id,
            startsAt: s.startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            durationMinutes: s.durationMinutes,
            notes: s.notes,
            lessonTemplateId: s.lessonTemplateId,
            lessonTitle: s.lessonTemplate?.title ?? null,
            myPlansToAttend: attBySlot.get(s.id) ?? null
          };
        })
      );
    }
  );

  app.patch(
    "/api/student/schedule-slots/:slotId/attendance",
    authRequired,
    roleGuard(["student"]),
    async (req: AuthenticatedRequest, res) => {
      const slotId = String(req.params.slotId);
      const parsed = z
        .object({
          plansToAttend: z.boolean().nullable()
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const slot = await prisma.classScheduleSlot.findUnique({
        where: { id: slotId },
        select: { id: true, classroomId: true, startsAt: true }
      });
      if (!slot) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const ok = await assertStudentInClassroom(req.session!.sub, slot.classroomId);
      if (!ok) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (slot.startsAt.getTime() < Date.now() - SCHEDULE_PAST_GRACE_MS) {
        res.status(400).json({ error: "Нельзя менять отметку для прошедшего занятия" });
        return;
      }
      const studentId = req.session!.sub;
      const value = parsed.data.plansToAttend;
      if (value === null) {
        await prisma.scheduleSlotAttendance.deleteMany({ where: { slotId, studentId } });
        res.json({ ok: true, myPlansToAttend: null });
        return;
      }
      const row = await prisma.scheduleSlotAttendance.upsert({
        where: { slotId_studentId: { slotId, studentId } },
        create: { slotId, studentId, plansToAttend: value },
        update: { plansToAttend: value }
      });
      res.json({ ok: true, myPlansToAttend: row.plansToAttend });
    }
  );

  app.post(
    "/api/admin/lesson-templates",
    authRequired,
    adminRequired,
    async (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          title: z.string().min(1),
          description: z.string().optional(),
          moduleKey: z.string().min(1),
          sortOrder: z.number().int().optional(),
          starterPayload: z.record(z.string(), z.unknown()),
          published: z.boolean().optional()
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const row = await prisma.lessonTemplate.create({
        data: {
          title: parsed.data.title,
          description: parsed.data.description,
          moduleKey: parsed.data.moduleKey,
          sortOrder: parsed.data.sortOrder ?? 0,
          starterPayload: parsed.data.starterPayload as Prisma.InputJsonValue,
          published: parsed.data.published ?? true
        }
      });
      res.json({ id: row.id });
    }
  );

  app.get(
    "/api/teacher/classrooms/:classroomId/assignments",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const classroomId = String(req.params.classroomId);
      const c = await assertTeacherClassroom(req.session!.sub, classroomId);
      if (!c) {
        res.status(404).json({ error: "Class not found" });
        return;
      }
      const list = await prisma.assignment.findMany({
        where: { classroomId },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { submissions: true } }
        }
      });
      res.json(
        list.map((a) => ({
          id: a.id,
          title: a.title,
          description: a.description,
          kind: a.kind,
          maxScore: a.maxScore,
          published: a.published,
          dueAt: a.dueAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
          submissionsCount: a._count.submissions
        }))
      );
    }
  );

  app.post(
    "/api/teacher/classrooms/:classroomId/assignments",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const classroomId = String(req.params.classroomId);
      const c = await assertTeacherClassroom(req.session!.sub, classroomId);
      if (!c) {
        res.status(404).json({ error: "Class not found" });
        return;
      }
      const parsed = z
        .object({
          title: z.string().min(2),
          description: z.string().optional(),
          kind: assignmentKindZ,
          maxScore: z.number().int().min(1).max(100).optional(),
          dueAt: z.string().datetime().optional().nullable(),
          published: z.boolean().optional(),
          lessonTemplateId: z.string().optional().nullable(),
          templateSnapshot: z.record(z.string(), z.unknown()).optional().nullable()
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      let templateSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
        parsed.data.templateSnapshot !== undefined && parsed.data.templateSnapshot !== null
          ? (parsed.data.templateSnapshot as Prisma.InputJsonValue)
          : undefined;
      let lessonTemplateId: string | null = parsed.data.lessonTemplateId ?? null;
      if (lessonTemplateId) {
        const lt = await prisma.lessonTemplate.findFirst({
          where: { id: lessonTemplateId, published: true }
        });
        if (!lt) {
          res.status(400).json({ error: "Invalid lesson template" });
          return;
        }
        templateSnapshot = lt.starterPayload as Prisma.InputJsonValue;
      }
      if (templateSnapshot === undefined) {
        templateSnapshot = EMPTY_SNAPSHOT;
      }
      let dueAt: Date | null = null;
      if (parsed.data.dueAt) {
        dueAt = new Date(parsed.data.dueAt);
        const dueErr = assertDueAtInFuture(dueAt);
        if (dueErr) {
          res.status(400).json({ error: dueErr });
          return;
        }
      }
      const a = await prisma.assignment.create({
        data: {
          classroomId,
          ownerId: req.session!.sub,
          title: parsed.data.title,
          description: parsed.data.description,
          kind: parsed.data.kind,
          maxScore: parsed.data.maxScore ?? 10,
          published: parsed.data.published ?? true,
          dueAt,
          templateSnapshot,
          lessonTemplateId
        }
      });
      if (a.published) {
        void notifyEnrolledStudentsNewAssignment(classroomId, a.title);
      }
      res.json({ id: a.id });
    }
  );

  app.patch(
    "/api/teacher/assignments/:assignmentId",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const assignmentId = String(req.params.assignmentId);
      const a = await prisma.assignment.findFirst({
        where: { id: assignmentId, ownerId: req.session!.sub }
      });
      if (!a) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const parsed = z
        .object({
          title: z.string().min(2).optional(),
          description: z.string().optional().nullable(),
          kind: assignmentKindZ.optional(),
          maxScore: z.number().int().min(1).max(100).optional(),
          dueAt: z.string().datetime().optional().nullable(),
          published: z.boolean().optional(),
          templateSnapshot: z.record(z.string(), z.unknown()).optional().nullable()
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      if (parsed.data.dueAt !== undefined && parsed.data.dueAt) {
        const d = new Date(parsed.data.dueAt);
        const dueErr = assertDueAtInFuture(d);
        if (dueErr) {
          res.status(400).json({ error: dueErr });
          return;
        }
      }
      const updated = await prisma.assignment.update({
        where: { id: assignmentId },
        data: {
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
          ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
          ...(parsed.data.maxScore !== undefined ? { maxScore: parsed.data.maxScore } : {}),
          ...(parsed.data.published !== undefined ? { published: parsed.data.published } : {}),
          ...(parsed.data.dueAt !== undefined
            ? { dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null }
            : {}),
          ...(parsed.data.templateSnapshot !== undefined
            ? {
                templateSnapshot:
                  parsed.data.templateSnapshot === null
                    ? Prisma.JsonNull
                    : (parsed.data.templateSnapshot as Prisma.InputJsonValue)
              }
            : {})
        }
      });
      res.json({ id: updated.id });
    }
  );

  app.get(
    "/api/teacher/classrooms/:classroomId/submissions",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const classroomId = String(req.params.classroomId);
      const c = await assertTeacherClassroom(req.session!.sub, classroomId);
      if (!c) {
        res.status(404).json({ error: "Class not found" });
        return;
      }
      const assignmentId = typeof req.query.assignmentId === "string" ? req.query.assignmentId : undefined;
      const where: Prisma.SubmissionWhereInput = {
        assignment: { classroomId }
      };
      if (assignmentId) {
        where.assignmentId = assignmentId;
      }
      const list = await prisma.submission.findMany({
        where,
        include: {
          student: { select: { id: true, nickname: true, email: true } },
          assignment: { select: { id: true, title: true, maxScore: true } }
        },
        orderBy: { updatedAt: "desc" }
      });
      res.json(
        list.map((s) => ({
          id: s.id,
          status: s.status,
          score: s.score,
          teacherNote: s.teacherNote,
          revisionNote: s.revisionNote,
          submittedAt: s.submittedAt?.toISOString() ?? null,
          gradedAt: s.gradedAt?.toISOString() ?? null,
          projectId: s.projectId,
          student: s.student,
          assignment: s.assignment
        }))
      );
    }
  );

  app.post(
    "/api/teacher/submissions/:submissionId/grade",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const submissionId = String(req.params.submissionId);
      const parsed = z
        .object({
          score: z.number().int().min(0).max(100).optional().nullable(),
          teacherNote: z.string().optional().nullable(),
          decision: z.enum(["grade", "revision"]),
          revisionNote: z.string().optional().nullable()
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const sub = await prisma.submission.findFirst({
        where: { id: submissionId },
        include: { assignment: true }
      });
      if (!sub || sub.assignment.ownerId !== req.session!.sub) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const now = new Date();
      if (parsed.data.decision === "revision") {
        await prisma.submission.update({
          where: { id: submissionId },
          data: {
            status: "needs_revision",
            revisionNote: parsed.data.revisionNote ?? null,
            teacherNote: parsed.data.teacherNote ?? null,
            score: null,
            gradedAt: null,
            teacherSeenAt: now
          }
        });
      } else {
        const max = sub.assignment.maxScore;
        const sc = parsed.data.score;
        if (sc === undefined || sc === null || sc > max) {
          res.status(400).json({ error: `Score required, 0..${max}` });
          return;
        }
        await prisma.submission.update({
          where: { id: submissionId },
          data: {
            status: "graded",
            score: sc,
            teacherNote: parsed.data.teacherNote ?? null,
            revisionNote: null,
            gradedAt: now,
            gradedSeenAt: null,
            teacherSeenAt: now
          }
        });
      }
      void prisma.analyticsEvent
        .create({
          data: {
            userId: req.session!.sub,
            name:
              parsed.data.decision === "grade" ? "lms_submission_graded" : "lms_submission_revision_requested",
            payload: {
              submissionId,
              assignmentId: sub.assignmentId,
              decision: parsed.data.decision,
              score: parsed.data.decision === "grade" ? parsed.data.score : null
            } as Prisma.InputJsonValue
          }
        })
        .catch(() => {});
      if (parsed.data.decision === "grade") {
        const sc = parsed.data.score!;
        void prisma.user
          .findUnique({ where: { id: sub.studentId }, select: { email: true } })
          .then((stu) => {
            if (!stu?.email) {
              return;
            }
            const appUrl = `${config.appBaseUrl.replace(/\/$/, "")}/class`;
            return sendStudentGradedEmail(stu.email, {
              assignmentTitle: sub.assignment.title,
              score: sc,
              maxScore: sub.assignment.maxScore,
              appUrl,
              comment: parsed.data.teacherNote
            });
          })
          .catch(() => {});
      }
      res.json({ ok: true });
    }
  );

  app.post(
    "/api/teacher/mark-new-enrollments-seen",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const teacherId = req.session!.sub;
      const classrooms = await prisma.classroom.findMany({
        where: { teacherId },
        select: { id: true }
      });
      const ids = classrooms.map((c) => c.id);
      if (ids.length === 0) {
        res.json({ ok: true, updated: 0 });
        return;
      }
      const now = new Date();
      const result = await prisma.enrollment.updateMany({
        where: { classroomId: { in: ids }, teacherSeenJoinAt: null },
        data: { teacherSeenJoinAt: now }
      });
      res.json({ ok: true, updated: result.count });
    }
  );

  app.post(
    "/api/teacher/mark-assignments-queue-seen",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const teacherId = req.session!.sub;
      const now = new Date();
      const result = await prisma.submission.updateMany({
        where: {
          status: "submitted",
          teacherSeenAt: null,
          assignment: { ownerId: teacherId }
        },
        data: { teacherSeenAt: now }
      });
      res.json({ ok: true, updated: result.count });
    }
  );

  app.post(
    "/api/teacher/submissions/mark-seen",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const parsed = z.object({ submissionIds: z.array(z.string()).min(1) }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const now = new Date();
      await prisma.submission.updateMany({
        where: {
          id: { in: parsed.data.submissionIds },
          assignment: { ownerId: req.session!.sub }
        },
        data: { teacherSeenAt: now }
      });
      res.json({ ok: true });
    }
  );

  app.get(
    "/api/teacher/classrooms/:classroomId/gradebook",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const classroomId = String(req.params.classroomId);
      const c = await assertTeacherClassroom(req.session!.sub, classroomId);
      if (!c) {
        res.status(404).json({ error: "Class not found" });
        return;
      }
      const [students, assignments, submissions] = await Promise.all([
        prisma.enrollment.findMany({
          where: { classroomId },
          include: { student: { select: { id: true, nickname: true } } },
          orderBy: { joinedAt: "asc" }
        }),
        prisma.assignment.findMany({
          where: { classroomId, published: true },
          orderBy: { createdAt: "asc" },
          select: { id: true, title: true, maxScore: true, kind: true }
        }),
        prisma.submission.findMany({
          where: { assignment: { classroomId } },
          select: {
            id: true,
            studentId: true,
            assignmentId: true,
            score: true,
            status: true
          }
        })
      ]);
      const subMap = new Map<string, (typeof submissions)[0]>();
      for (const s of submissions) {
        subMap.set(`${s.studentId}_${s.assignmentId}`, s);
      }
      res.json({
        students: students.map((e) => ({
          id: e.student.id,
          nickname: e.student.nickname
        })),
        assignments,
        cells: students.flatMap((e) =>
          assignments.map((a) => {
            const s = subMap.get(`${e.student.id}_${a.id}`);
            return {
              studentId: e.student.id,
              assignmentId: a.id,
              score: s?.score ?? null,
              status: s?.status ?? "not_started"
            };
          })
        )
      });
    }
  );

  app.get("/api/student/assignments", authRequired, roleGuard(["student"]), async (req: AuthenticatedRequest, res) => {
    const studentId = req.session!.sub;
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId },
      include: {
        classroom: {
          select: {
            id: true,
            title: true,
            school: { select: { name: true } },
            assignments: {
              where: { published: true },
              orderBy: { createdAt: "desc" },
              include: {
                submissions: {
                  where: { studentId },
                  take: 1
                }
              }
            }
          }
        }
      }
    });
    const out: {
      assignmentId: string;
      classroomId: string;
      classroomTitle: string;
      schoolName: string;
      title: string;
      kind: string;
      dueAt: string | null;
      maxScore: number;
      submission: {
        id: string;
        status: string;
        score: number | null;
        projectId: string | null;
        gradedSeenAt: string | null;
        teacherNote: string | null;
        revisionNote: string | null;
      } | null;
    }[] = [];
    for (const en of enrollments) {
      for (const a of en.classroom.assignments) {
        const sub = a.submissions[0];
        out.push({
          assignmentId: a.id,
          classroomId: en.classroom.id,
          classroomTitle: en.classroom.title,
          schoolName: en.classroom.school.name,
          title: a.title,
          kind: a.kind,
          dueAt: a.dueAt?.toISOString() ?? null,
          maxScore: a.maxScore,
          submission: sub
            ? {
                id: sub.id,
                status: sub.status,
                score: sub.score,
                projectId: sub.projectId,
                gradedSeenAt: sub.gradedSeenAt?.toISOString() ?? null,
                teacherNote: sub.teacherNote,
                revisionNote: sub.revisionNote
              }
            : null
        });
      }
    }
    res.json(out);
  });

  app.post(
    "/api/student/assignments/:assignmentId/start",
    authRequired,
    roleGuard(["student"]),
    async (req: AuthenticatedRequest, res) => {
      const assignmentId = String(req.params.assignmentId);
      const studentId = req.session!.sub;
      const assignment = await prisma.assignment.findFirst({
        where: { id: assignmentId, published: true }
      });
      if (!assignment) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }
      const en = await assertStudentInClassroom(studentId, assignment.classroomId);
      if (!en) {
        res.status(403).json({ error: "Not enrolled" });
        return;
      }
      const existing = await prisma.submission.findUnique({
        where: { assignmentId_studentId: { assignmentId, studentId } }
      });
      if (existing?.projectId) {
        res.json({ projectId: existing.projectId, submissionId: existing.id, status: existing.status });
        return;
      }
      const payload = (assignment.templateSnapshot ?? EMPTY_SNAPSHOT) as Prisma.InputJsonValue;
      const projectId = `p_${randomBytes(12).toString("hex")}`;
      await prisma.$transaction([
        prisma.project.create({
          data: {
            id: projectId,
            userId: studentId,
            title: `${assignment.title}`,
            snapshot: { create: { payload } }
          }
        }),
        prisma.submission.upsert({
          where: { assignmentId_studentId: { assignmentId, studentId } },
          create: {
            assignmentId,
            studentId,
            projectId,
            status: "draft"
          },
          update: {
            projectId,
            status: "draft"
          }
        })
      ]);
      res.json({ projectId, submissionId: (await prisma.submission.findUnique({
        where: { assignmentId_studentId: { assignmentId, studentId } }
      }))!.id, status: "draft" });
    }
  );

  app.post(
    "/api/student/assignments/:assignmentId/submit",
    authRequired,
    roleGuard(["student"]),
    async (req: AuthenticatedRequest, res) => {
      const assignmentId = String(req.params.assignmentId);
      const studentId = req.session!.sub;
      const sub = await prisma.submission.findUnique({
        where: { assignmentId_studentId: { assignmentId, studentId } },
        include: { assignment: true }
      });
      if (!sub?.projectId) {
        res.status(400).json({ error: "Start assignment first" });
        return;
      }
      const en = await assertStudentInClassroom(studentId, sub.assignment.classroomId);
      if (!en) {
        res.status(403).json({ error: "Not enrolled" });
        return;
      }
      if (sub.status === "submitted") {
        res.status(400).json({ error: "Работа уже сдана. Дождитесь проверки учителя." });
        return;
      }
      if (sub.status !== "draft" && sub.status !== "needs_revision") {
        res.status(400).json({ error: "Сдать работу сейчас нельзя" });
        return;
      }
      const now = new Date();
      await prisma.submission.update({
        where: { id: sub.id },
        data: {
          status: "submitted",
          submittedAt: now,
          teacherSeenAt: null
        }
      });
      void prisma.analyticsEvent
        .create({
          data: {
            userId: studentId,
            name: "lms_assignment_submitted",
            payload: {
              assignmentId,
              submissionId: sub.id,
              classroomId: sub.assignment.classroomId
            } as Prisma.InputJsonValue
          }
        })
        .catch(() => {});
      const [teacher, studentNick] = await Promise.all([
        prisma.user.findUnique({ where: { id: sub.assignment.ownerId }, select: { email: true } }),
        prisma.user.findUnique({ where: { id: studentId }, select: { nickname: true } })
      ]);
      if (teacher?.email && studentNick) {
        const appUrl = `${config.appBaseUrl.replace(/\/$/, "")}/teacher`;
        void sendTeacherSubmissionEmail(teacher.email, {
          studentNickname: studentNick.nickname,
          assignmentTitle: sub.assignment.title,
          appUrl
        }).catch(() => {});
      }
      res.json({ ok: true });
    }
  );

  app.get(
    "/api/student/projects/:projectId/submission-context",
    authRequired,
    roleGuard(["student"]),
    async (req: AuthenticatedRequest, res) => {
      const projectId = String(req.params.projectId);
      const studentId = req.session!.sub;
      const sub = await prisma.submission.findFirst({
        where: { studentId, projectId },
        include: {
          assignment: {
            select: { id: true, title: true, maxScore: true, classroom: { select: { title: true } } }
          }
        }
      });
      if (!sub) {
        res.status(404).json({ error: "Not linked" });
        return;
      }
      res.json({
        assignmentId: sub.assignmentId,
        assignmentTitle: sub.assignment.title,
        classroomTitle: sub.assignment.classroom.title,
        status: sub.status,
        canSubmit: sub.status === "draft" || sub.status === "needs_revision",
        teacherNote: sub.teacherNote,
        revisionNote: sub.revisionNote,
        score: sub.score,
        maxScore: sub.assignment.maxScore
      });
    }
  );

  app.get(
    "/api/teacher/submissions/:submissionId/work",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const submissionId = String(req.params.submissionId);
      const sub = await prisma.submission.findFirst({
        where: { id: submissionId },
        include: {
          assignment: true,
          project: { include: { snapshot: true } },
          student: { select: { nickname: true, email: true } }
        }
      });
      if (!sub || sub.assignment.ownerId !== req.session!.sub) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (!sub.project?.snapshot) {
        res.status(404).json({ error: "Нет проекта или снапшота" });
        return;
      }
      res.json({
        meta: {
          id: sub.project.id,
          userId: sub.project.userId,
          title: `${sub.assignment.title} — ${sub.student.nickname}`,
          createdAt: sub.project.createdAt.toISOString(),
          updatedAt: sub.project.updatedAt.toISOString(),
          readOnly: true,
          reviewSubmissionId: sub.id
        },
        snapshot: sub.project.snapshot.payload,
        review: {
          submissionId: sub.id,
          status: sub.status,
          score: sub.score,
          maxScore: sub.assignment.maxScore,
          studentNickname: sub.student.nickname,
          assignmentTitle: sub.assignment.title,
          teacherNote: sub.teacherNote,
          revisionNote: sub.revisionNote
        }
      });
    }
  );

  app.post(
    "/api/student/submissions/:submissionId/mark-graded-seen",
    authRequired,
    roleGuard(["student"]),
    async (req: AuthenticatedRequest, res) => {
      const submissionId = String(req.params.submissionId);
      const sub = await prisma.submission.findFirst({
        where: { id: submissionId, studentId: req.session!.sub }
      });
      if (!sub) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      await prisma.submission.update({
        where: { id: submissionId },
        data: { gradedSeenAt: new Date() }
      });
      res.json({ ok: true });
    }
  );

  app.post(
    "/api/projects/:projectId/share-link",
    authRequired,
    async (req: AuthenticatedRequest, res) => {
      const projectId = String(req.params.projectId);
      const p = await prisma.project.findFirst({
        where: { id: projectId, userId: req.session!.sub }
      });
      if (!p) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const token = randomBytes(24).toString("hex");
      const share = await prisma.projectShare.create({
        data: {
          token,
          sourceProjectId: projectId,
          createdById: req.session!.sub
        }
      });
      res.json({ token: share.token });
    }
  );

  app.get("/api/share/:token/meta", async (req, res) => {
    const token = String(req.params.token);
    const share = await prisma.projectShare.findUnique({
      where: { token },
      include: { sourceProject: { select: { title: true } } }
    });
    if (!share || (share.expiresAt && share.expiresAt < new Date())) {
      res.status(404).json({ error: "Invalid or expired link" });
      return;
    }
    res.json({ title: share.sourceProject.title });
  });

  app.post("/api/share/:token/claim", authRequired, async (req: AuthenticatedRequest, res) => {
    const token = String(req.params.token);
    const share = await prisma.projectShare.findUnique({
      where: { token },
      include: {
        sourceProject: { include: { snapshot: true } }
      }
    });
    if (!share || (share.expiresAt && share.expiresAt < new Date())) {
      res.status(404).json({ error: "Invalid or expired link" });
      return;
    }
    if (!share.sourceProject.snapshot) {
      res.status(400).json({ error: "No snapshot" });
      return;
    }
    const userId = req.session!.sub;
    const newId = `p_${randomBytes(12).toString("hex")}`;
    const title = `${share.sourceProject.title} (копия)`;
    await prisma.project.create({
      data: {
        id: newId,
        userId,
        title,
        snapshot: {
          create: { payload: share.sourceProject.snapshot.payload as Prisma.InputJsonValue }
        }
      }
    });
    res.json({ projectId: newId, title, importedFromShare: true });
  });
}

const LESSON_GUIDE_SEED: Record<string, { teacherGuideMd: string; studentSummary: string }> = {
  lt_intro_ai: {
    studentSummary:
      "Познакомишься с идеей обучения модели на примерах и с визуальным программированием в Nodly.",
    teacherGuideMd: `# Методичка: урок 1 — Введение в ИИ

## Цели
- Снять страх перед термином «нейросеть».
- Показать связь: данные → модель → ответ.

## Ход (45 мин)
1. Мотивация: где ИИ вокруг (5 мин).
2. Демо в Nodly: блок «Старт» и цепочка (15 мин).
3. Практика по заготовке урока (20 мин).
4. Рефлексия: что запомнили (5 мин).

## Вопросы ученикам
- Чем обучение модели похоже на учёбу человека?
`
  },
  lt_data_label: {
    studentSummary: "Разберёшься, зачем модели нужны данные и как их описывать классами.",
    teacherGuideMd: `# Методичка: урок 2 — Данные и разметка

## Цели
- Понять разницу между входом и меткой (классом).
- Собрать мини-набор в проекте.

## Материалы
- Примеры картинок или таблицы из методички школы.

## Активности
- Создание 2–3 классов в библиотеке данных.
- Обсуждение качества разметки.
`
  },
  lt_first_model: {
    studentSummary: "Соберёшь первую простую модель в Blockly и проверишь её на примере.",
    teacherGuideMd: `# Методичка: урок 3 — Первая модель

## Цели
- Пройти путь: данные → обучение → предсказание.
- Зафиксировать ошибки как часть процесса.

## Замечания учителю
- Не требовать идеальной точности на первом проходе.
- Поощрять эксперименты с разными наборами.
`
  }
};

export async function ensureLessonTemplateSeed() {
  const n = await prisma.lessonTemplate.count();
  if (n > 0) {
    return;
  }
  const seeds = [
    {
      id: "lt_intro_ai",
      title: "Урок 1. Введение в ИИ",
      description: "Заготовка из каталога",
      moduleKey: "module_a",
      sortOrder: 1,
      ...LESSON_GUIDE_SEED.lt_intro_ai
    },
    {
      id: "lt_data_label",
      title: "Урок 2. Данные и разметка",
      description: "Заготовка из каталога",
      moduleKey: "module_a",
      sortOrder: 2,
      ...LESSON_GUIDE_SEED.lt_data_label
    },
    {
      id: "lt_first_model",
      title: "Урок 3. Первая модель",
      description: "Заготовка из каталога",
      moduleKey: "module_a",
      sortOrder: 3,
      ...LESSON_GUIDE_SEED.lt_first_model
    }
  ];
  for (const s of seeds) {
    await prisma.lessonTemplate.create({
      data: {
        ...s,
        starterPayload: EMPTY_SNAPSHOT,
        published: true
      }
    });
  }
}

/** Подтягивает тексты методичек для уже существующих шаблонов после миграции. */
export async function ensureLessonTemplateGuides() {
  for (const [id, data] of Object.entries(LESSON_GUIDE_SEED)) {
    await prisma.lessonTemplate.updateMany({
      where: { id },
      data: {
        teacherGuideMd: data.teacherGuideMd,
        studentSummary: data.studentSummary
      }
    });
  }
}
