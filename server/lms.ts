import type { Express } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import {
  adminRequired,
  authRequired,
  roleGuard,
  type AuthenticatedRequest
} from "./auth.js";

const EMPTY_SNAPSHOT: Prisma.InputJsonValue = {
  imageDatasets: [],
  tabularDatasets: [],
  imagePredictionInputs: [],
  tabularPredictionInputs: [],
  savedModels: [],
  blocklyState: ""
};

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
      const pendingReview = await prisma.submission.count({
        where: {
          status: "submitted",
          teacherSeenAt: null,
          assignment: { classroomId: { in: ids } }
        }
      });
      res.json({ pendingReviewCount: pendingReview });
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
      const a = await prisma.assignment.create({
        data: {
          classroomId,
          ownerId: req.session!.sub,
          title: parsed.data.title,
          description: parsed.data.description,
          kind: parsed.data.kind,
          maxScore: parsed.data.maxScore ?? 10,
          published: parsed.data.published ?? true,
          dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
          templateSnapshot,
          lessonTemplateId
        }
      });
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
      res.json({ ok: true });
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
                gradedSeenAt: sub.gradedSeenAt?.toISOString() ?? null
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
      const now = new Date();
      await prisma.submission.update({
        where: { id: sub.id },
        data: {
          status: "submitted",
          submittedAt: now,
          teacherSeenAt: null
        }
      });
      res.json({ ok: true });
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
      sortOrder: 1
    },
    {
      id: "lt_data_label",
      title: "Урок 2. Данные и разметка",
      description: "Заготовка из каталога",
      moduleKey: "module_a",
      sortOrder: 2
    },
    {
      id: "lt_first_model",
      title: "Урок 3. Первая модель",
      description: "Заготовка из каталога",
      moduleKey: "module_a",
      sortOrder: 3
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
