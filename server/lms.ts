import type { Express } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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

const EMPTY_MINI_PROJECT_SNAPSHOT: Record<string, unknown> = {
  imageDatasets: [],
  tabularDatasets: [],
  imagePredictionInputs: [],
  tabularPredictionInputs: [],
  savedModels: [],
  blocklyState: "",
  workspaceLevel: 1
};

/** Один tabular-датасет из `public/Iris.csv` для пустой мини-разработки (колонка вида — последняя). */
function irisTabularDatasetEntryFromPublicCsv(): Record<string, unknown> {
  const fp = path.join(process.cwd(), "public", "Iris.csv");
  const headers = ["sepal_length", "sepal_width", "petal_length", "petal_width", "species"];
  const targetColumnIndex = 4;
  let rows: string[][] = [];
  if (existsSync(fp)) {
    const text = readFileSync(fp, "utf8");
    rows = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((line) => line.split(",").map((c) => c.trim()))
      .filter((r) => r.length >= 5);
  }
  return {
    id: "tabular_seed_iris_csv",
    title: "Iris (Iris.csv)",
    dataset: {
      headers,
      rows,
      targetColumnIndex
    }
  };
}

/** Лабораторные записи измерений цветков (оранжерея), `public/Iris_lab_greenhouse.csv`. */
function irisLabTabularDatasetEntryFromPublicCsv(): Record<string, unknown> {
  const fp = path.join(process.cwd(), "public", "Iris_lab_greenhouse.csv");
  const headers = ["sepal_length", "sepal_width", "petal_length", "petal_width", "species"];
  const targetColumnIndex = 4;
  let rows: string[][] = [];
  if (existsSync(fp)) {
    const text = readFileSync(fp, "utf8");
    rows = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((line) => line.split(",").map((c) => c.trim()))
      .filter((r) => r.length >= 5);
  }
  return {
    id: "tabular_seed_iris_lab_csv",
    title: "Оранжерея лаборатории (50 цветков)",
    dataset: {
      headers,
      rows,
      targetColumnIndex
    }
  };
}

function irisQuestMiniTabularDatasets(): Record<string, unknown>[] {
  return [irisTabularDatasetEntryFromPublicCsv(), irisLabTabularDatasetEntryFromPublicCsv()];
}

function cloneJson<T>(v: T): T {
  return structuredClone(v);
}

function lessonFlowBlocksFromContent(lessonContent: unknown): unknown[] {
  if (!lessonContent || typeof lessonContent !== "object") {
    return [];
  }
  const blocks = (lessonContent as { blocks?: unknown }).blocks;
  return Array.isArray(blocks) ? blocks : [];
}

type MiniPracticeParsed =
  | { kind: "template" }
  | { kind: "project_clone"; referenceProjectId: string }
  | { kind: "empty"; workspaceLevel: 1 | 2 };

function parseMiniStudioBlock(block: unknown): MiniPracticeParsed | null {
  if (!block || typeof block !== "object") {
    return null;
  }
  const b = block as Record<string, unknown>;
  if (b.type !== "studio") {
    return null;
  }
  const kindRaw = b.studioPracticeKind;
  const ref =
    typeof b.referenceProjectId === "string" && b.referenceProjectId.trim().length > 0
      ? b.referenceProjectId.trim()
      : null;
  const w = b.studioWorkspaceLevel;
  const rawLevel: 1 | 2 | 3 | null =
    w === 1 || w === 2 || w === 3 ? w : w === "1" || w === "2" || w === "3" ? (Number(w) as 1 | 2 | 3) : null;
  const level: 1 | 2 | null = rawLevel == null ? null : rawLevel === 1 ? 1 : 2;

  if (kindRaw === "template") {
    return { kind: "template" };
  }
  if (kindRaw === "empty") {
    if (level == null) {
      throw new Error("Для пустой практики в блоке урока нужно выбрать уровень Blockly (1 или 2)");
    }
    return { kind: "empty", workspaceLevel: level };
  }
  if (kindRaw === "project_clone") {
    if (!ref) {
      throw new Error("Для копии проекта укажите id облачного проекта-образца");
    }
    return { kind: "project_clone", referenceProjectId: ref };
  }
  if (ref) {
    return { kind: "project_clone", referenceProjectId: ref };
  }
  return { kind: "template" };
}

function normalizeProjectSnapshotPayload(raw: unknown): Record<string, unknown> {
  const empty = cloneJson(EMPTY_MINI_PROJECT_SNAPSHOT);
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const merged: Record<string, unknown> = { ...empty, ...src };
  const wl = merged.workspaceLevel;
  if (wl !== 1 && wl !== 2 && wl !== 3) {
    merged.workspaceLevel = 1;
  } else if (wl === 3) {
    merged.workspaceLevel = 2;
  }
  return merged;
}

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
    const to = e.student.email?.trim();
    if (!to) {
      continue;
    }
    void sendStudentNewAssignmentEmail(to, {
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

/** Дедлайн ДЗ: конец календарного дня (UTC) через daysAfter дней от даты занятия */
function homeworkDueAfterLessonDays(slotStart: Date, daysAfter: number): Date {
  return new Date(
    Date.UTC(
      slotStart.getUTCFullYear(),
      slotStart.getUTCMonth(),
      slotStart.getUTCDate() + daysAfter,
      23,
      59,
      59,
      999
    )
  );
}

const LMS_HOMEWORK_HORIZON_DAYS = 4;
/** Согласовано с `MAX_CALENDAR_STRETCH_DAYS` на фронте (сводка по слотам). */
const SUMMARY_SCHEDULE_STRETCH_DAYS = 21;

function startOfLocalDay(base: Date = new Date()): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addLocalDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

const assignmentKindsLmsZ = ["classwork", "homework"] as const;

function sortLinkedAssignmentsByKind<T extends { kind: string }>(items: T[]): T[] {
  const rank = (k: string) => (k === "classwork" ? 0 : 1);
  return [...items].sort((a, b) => rank(a.kind) - rank(b.kind));
}

function homeworkEndOfLocalDayMs(d: Date): number {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

function submissionFinishedForDeadline(st: string): boolean {
  return (
    st === "submitted" ||
    st === "auto_checked" ||
    st === "pending_teacher_review" ||
    st === "graded"
  );
}

function homeworkOverdueUnfinished(dueAt: Date | null, st: string): boolean {
  if (!dueAt || submissionFinishedForDeadline(st)) {
    return false;
  }
  return homeworkEndOfLocalDayMs(dueAt) < Date.now();
}

function homeworkDueSoonUnfinished(dueAt: Date | null, st: string, horizonDays: number): boolean {
  if (!dueAt || submissionFinishedForDeadline(st)) {
    return false;
  }
  if (homeworkOverdueUnfinished(dueAt, st)) {
    return false;
  }
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + horizonDays);
  horizon.setHours(23, 59, 59, 999);
  return homeworkEndOfLocalDayMs(dueAt) <= horizon.getTime();
}

type HomeworkTaskSummary = {
  testCount: number;
  openCount: number;
  projectCount: number;
  testBlockIds: string[];
  /** Id блоков `studio` в уроке (для проверки мини-проектов при сдаче без основного projectId). */
  studioBlockIds: string[];
};

function summarizeHomeworkTasks(lessonContent: unknown): HomeworkTaskSummary {
  let testCount = 0;
  let openCount = 0;
  let projectCount = 0;
  const testBlockIds: string[] = [];
  const studioBlockIds: string[] = [];
  if (!lessonContent || typeof lessonContent !== "object") {
    return { testCount, openCount, projectCount, testBlockIds, studioBlockIds };
  }
  const lc = lessonContent as Record<string, unknown>;
  const blocks = Array.isArray(lc.blocks) ? lc.blocks : [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const b = block as Record<string, unknown>;
    const blockId = typeof b.id === "string" ? b.id : null;
    if (b.type === "checkpoint") {
      const mode = b.answerMode;
      if (mode === "single" || mode === "multi") {
        testCount += 1;
        if (blockId) {
          testBlockIds.push(blockId);
        }
      } else {
        openCount += 1;
      }
    } else if (b.type === "studio") {
      projectCount += 1;
      if (blockId) {
        studioBlockIds.push(blockId);
      }
    }
  }
  const checkpoints = Array.isArray(lc.checkpoints) ? lc.checkpoints : [];
  if (blocks.length === 0 && checkpoints.length > 0) {
    for (const c of checkpoints) {
      if (!c || typeof c !== "object") {
        continue;
      }
      const mode = (c as Record<string, unknown>).answerMode;
      if (mode === "single" || mode === "multi") {
        testCount += 1;
      } else {
        openCount += 1;
      }
    }
  }
  return { testCount, openCount, projectCount, testBlockIds, studioBlockIds };
}

function computeHomeworkAutoPart(
  maxScore: number,
  tasks: HomeworkTaskSummary,
  stateRaw: unknown
): { autoScore: number; autoMax: number; manualMax: number; solvedTests: number } {
  const hasTests = tasks.testCount > 0;
  const hasManual = tasks.openCount + tasks.projectCount > 0;
  const autoWeight = hasTests ? (hasManual ? 40 : 100) : hasManual ? 0 : 100;
  const autoMax = Math.round((maxScore * autoWeight) / 100);
  const manualMax = Math.max(0, maxScore - autoMax);
  const state =
    stateRaw && typeof stateRaw === "object"
      ? (stateRaw as { checkpoints?: Record<string, string> })
      : null;
  const checkpoints = state?.checkpoints ?? {};
  let solvedTests = 0;
  if (hasTests && tasks.testBlockIds.length > 0) {
    for (const id of tasks.testBlockIds) {
      if (checkpoints[id] === "ok") {
        solvedTests += 1;
      }
    }
  }
  const autoScore =
    hasTests && tasks.testCount > 0 ? Math.round((autoMax * solvedTests) / tasks.testCount) : autoMax;
  return { autoScore, autoMax, manualMax, solvedTests };
}

function lessonCheckpointIds(lessonContent: unknown): string[] {
  if (!lessonContent || typeof lessonContent !== "object") {
    return [];
  }
  const lc = lessonContent as Record<string, unknown>;
  const out: string[] = [];
  const blocks = Array.isArray(lc.blocks) ? lc.blocks : [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const b = block as Record<string, unknown>;
    if (b.type === "checkpoint" && typeof b.id === "string" && b.id.trim().length > 0) {
      out.push(b.id);
    }
  }
  if (out.length > 0) {
    return out;
  }
  const checkpoints = Array.isArray(lc.checkpoints) ? lc.checkpoints : [];
  for (let i = 0; i < checkpoints.length; i++) {
    out.push(`legacy-checkpoint-${i + 1}`);
  }
  return out;
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

const assignmentKindZ = z.enum(assignmentKindsLmsZ);
const lessonContentSlideZ = z.object({
  title: z.string().min(1).max(180),
  body: z.string().min(1).max(8000),
  mediaUrl: z.string().url().optional().nullable()
});
const lessonContentPracticeStepZ = z.object({
  title: z.string().min(1).max(180),
  instruction: z.string().min(1).max(8000),
  ctaAction: z.string().min(1).max(120).optional().nullable()
});
const lessonContentCheckpointZ = z.object({
  question: z.string().min(1).max(8000),
  expectedAnswer: z.string().min(1).max(8000),
  answerMode: z.enum(["text", "single", "multi"]).optional(),
  options: z.array(z.string().min(1).max(300)).max(24).optional()
});
const lessonContentHintZ = z.object({
  title: z.string().min(1).max(180),
  text: z.string().min(1).max(8000)
});
const presentationPdfUrlZ = z
  .union([z.string().max(2048), z.null()])
  .optional()
  .refine(
    (s) =>
      s === undefined ||
      s === null ||
      s === "" ||
      s.startsWith("/") ||
      /^https?:\/\//i.test(s),
    { message: "presentationPdfUrl: нужен https-URL или путь с / в начале" }
  );

const blockMediaUrlZ = z
  .string()
  .min(1)
  .max(2048)
  .refine((s) => s.startsWith("/") || /^https?:\/\//i.test(s), { message: "url: https или путь с /" });

const lessonBlockIdZ = z.string().min(1).max(80);
const textBlockZ = z.object({
  id: lessonBlockIdZ,
  type: z.literal("text"),
  body: z.string().min(1).max(20000),
  textScale: z.enum(["sm", "md", "lg"]).optional()
});
const imageBlockZ = z.object({
  id: lessonBlockIdZ,
  type: z.literal("image"),
  url: blockMediaUrlZ,
  caption: z.string().max(500).optional().nullable()
});
const pdfBlockZ = z.object({
  id: lessonBlockIdZ,
  type: z.literal("pdf"),
  url: blockMediaUrlZ,
  caption: z.string().max(500).optional().nullable()
});
const mediaBlockZ = z.object({
  id: lessonBlockIdZ,
  type: z.literal("media"),
  kind: z.enum(["image", "pdf"]),
  url: blockMediaUrlZ,
  caption: z.string().max(500).optional().nullable()
});
const studioGoalZ = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(220),
    type: z.literal("add_block"),
    blockType: z.string().min(1).max(120)
  }),
  z.object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(220),
    type: z.literal("select_dataset"),
    datasetKind: z.enum(["image", "tabular"])
  }),
  z.object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(220),
    type: z.literal("train_model")
  }),
  z.object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(220),
    type: z.literal("run_prediction")
  }),
  z.object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(220),
    type: z.literal("save_model")
  })
]);
const studioBlockZ = z.object({
  id: lessonBlockIdZ,
  type: z.literal("studio"),
  instruction: z.string().max(8000),
  ctaAction: z.string().max(120).optional().nullable(),
  studioPracticeKind: z.enum(["template", "project_clone", "empty"]).optional(),
  referenceProjectId: z.string().min(1).max(120).optional().nullable(),
  studioWorkspaceLevel: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 3 ? 2 : v)),
  goals: z.array(studioGoalZ).max(20).optional()
});
const checkpointBlockZ = z.object({
  id: lessonBlockIdZ,
  type: z.literal("checkpoint"),
  question: z.string().min(1).max(8000),
  expectedAnswer: z.string().min(1).max(8000),
  answerMode: z.enum(["text", "single", "multi"]).optional(),
  options: z.array(z.string().min(1).max(300)).max(24).optional()
});
const dividerBlockZ = z.object({
  id: lessonBlockIdZ,
  type: z.literal("divider")
});

const lessonBlockZ = z.discriminatedUnion("type", [
  textBlockZ,
  mediaBlockZ,
  imageBlockZ,
  pdfBlockZ,
  studioBlockZ,
  checkpointBlockZ,
  dividerBlockZ
]);

const deckInnerBlockZ = z.discriminatedUnion("type", [
  textBlockZ,
  mediaBlockZ,
  imageBlockZ,
  pdfBlockZ,
  studioBlockZ,
  checkpointBlockZ
]);

const deckLayoutZ = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(4).max(100),
  h: z.number().min(4).max(100)
});

const deckElementZ = z.object({
  id: lessonBlockIdZ,
  layout: deckLayoutZ,
  zIndex: z.number().int().min(0).max(2000).optional(),
  block: deckInnerBlockZ
});

const deckSlideZ = z.object({
  id: lessonBlockIdZ,
  title: z.string().max(200).optional(),
  backgroundImageUrl: z
    .union([z.string().max(2048), z.null()])
    .optional()
    .refine(
      (s) =>
        s === undefined ||
        s === null ||
        s === "" ||
        s.startsWith("/") ||
        /^https?:\/\//i.test(s),
      { message: "deck slide background: https или путь с /" }
    ),
  elements: z.array(deckElementZ).max(20)
});

const lessonContentDeckZ = z.object({
  schemaVersion: z.literal(1),
  slides: z.array(deckSlideZ).max(35)
});

const lessonContentZ = z
  .object({
    schemaVersion: z.number().int().min(1).max(10).optional(),
    blocks: z.array(lessonBlockZ).max(100).optional(),
    deck: lessonContentDeckZ.optional(),
    presentationPdfUrl: presentationPdfUrlZ,
    slides: z.array(lessonContentSlideZ).default([]),
    practiceSteps: z.array(lessonContentPracticeStepZ).default([]),
    checkpoints: z.array(lessonContentCheckpointZ).default([]),
    hints: z.array(lessonContentHintZ).default([])
  })
  .superRefine((data, ctx) => {
    if (data.deck?.slides?.length) {
      let n = 0;
      for (const s of data.deck.slides) {
        n += s.elements.length;
      }
      if (n > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "В режиме слайдов суммарно не больше 100 элементов (блоков)."
        });
      }
    }
  });

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
            status: { in: ["submitted", "pending_teacher_review"] },
            teacherSeenAt: null,
            assignment: { classroomId: { in: ids }, kind: { in: [...assignmentKindsLmsZ] } }
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
      const enrollments = await prisma.enrollment.findMany({
        where: { studentId: userId },
        select: { classroomId: true }
      });
      const classroomIds = enrollments.map((e) => e.classroomId);
      const startToday = startOfLocalDay();
      const upcomingScheduleEnd = addLocalDays(startToday, SUMMARY_SCHEDULE_STRETCH_DAYS + 1);

      const [attention, homeworkAssignments, homeworkDoneGradedCount, upcomingMarkedSlotsCount, pastMarkedSlotsCount] =
        await Promise.all([
          prisma.submission.count({
            where: {
              studentId: userId,
              OR: [
                { status: "graded", gradedSeenAt: null },
                { status: "needs_revision" }
              ]
            }
          }),
          classroomIds.length === 0
            ? Promise.resolve([])
            : prisma.assignment.findMany({
                where: {
                  classroomId: { in: classroomIds },
                  published: true,
                  kind: "homework"
                },
                select: {
                  dueAt: true,
                  submissions: {
                    where: { studentId: userId },
                    take: 1,
                    select: { status: true }
                  }
                }
              }),
          classroomIds.length === 0
            ? Promise.resolve(0)
            : prisma.submission.count({
                where: {
                  studentId: userId,
                  status: "graded",
                  assignment: {
                    kind: "homework",
                    published: true,
                    classroomId: { in: classroomIds }
                  }
                }
              }),
          classroomIds.length === 0
            ? Promise.resolve(0)
            : prisma.scheduleSlotAttendance.count({
                where: {
                  studentId: userId,
                  plansToAttend: true,
                  slot: {
                    classroomId: { in: classroomIds },
                    startsAt: { gte: startToday, lt: upcomingScheduleEnd }
                  }
                }
              }),
          classroomIds.length === 0
            ? Promise.resolve(0)
            : prisma.scheduleSlotAttendance.count({
                where: {
                  studentId: userId,
                  plansToAttend: true,
                  slot: {
                    classroomId: { in: classroomIds },
                    startsAt: { lt: startToday }
                  }
                }
              })
        ]);
      let homeworkTodoCount = 0;
      let homeworkOverdueCount = 0;
      let homeworkDueSoonCount = 0;
      let submittedPendingReviewCount = 0;
      for (const a of homeworkAssignments) {
        const st = a.submissions[0]?.status ?? "not_started";
        if (st === "submitted" || st === "pending_teacher_review") {
          submittedPendingReviewCount++;
          continue;
        }
        if (st === "graded" || st === "auto_checked") {
          continue;
        }
        homeworkTodoCount++;
        if (a.dueAt) {
          if (homeworkOverdueUnfinished(a.dueAt, st)) {
            homeworkOverdueCount++;
          } else if (homeworkDueSoonUnfinished(a.dueAt, st, LMS_HOMEWORK_HORIZON_DAYS)) {
            homeworkDueSoonCount++;
          }
        }
      }
      res.json({
        assignmentAttentionCount: attention,
        homeworkTodoCount,
        homeworkOverdueCount,
        homeworkDueSoonCount,
        submittedPendingReviewCount,
        homeworkDoneGradedCount,
        upcomingMarkedSlotsCount,
        pastMarkedSlotsCount
      });
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
    /** С запасом под скользящее окно календаря на главной (MAX_CALENDAR_STRETCH_DAYS ≈ 21 + колонки). */
    const horizonEnd = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
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
      slots: slots.map((s) => {
        const endsAt = s.endsAt ?? computeEndsAtFromDuration(s.startsAt, s.durationMinutes);
        return {
          id: s.id,
          startsAt: s.startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          durationMinutes: s.durationMinutes,
          lessonTitle: s.lessonTemplate?.title ?? null,
          notes: s.notes,
          classroomTitle: s.classroom.title,
          classroomId: s.classroomId
        };
      })
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
        sortOrder: t.sortOrder,
        lessonContent: t.lessonContent
      }))
    );
  });

  app.get("/api/lesson-templates/:id/content", authRequired, async (req, res) => {
    const id = String(req.params.id);
    const t = await prisma.lessonTemplate.findFirst({
      where: { id, published: true },
      select: {
        id: true,
        title: true,
        moduleKey: true,
        sortOrder: true,
        studentSummary: true,
        lessonContent: true
      }
    });
    if (!t) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(t);
  });

  app.get("/api/admin/lesson-templates/:id/content", authRequired, adminRequired, async (req, res) => {
    const id = String(req.params.id);
    const t = await prisma.lessonTemplate.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        moduleKey: true,
        sortOrder: true,
        description: true,
        published: true,
        studentSummary: true,
        lessonContent: true
      }
    });
    if (!t) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(t);
  });

  app.patch(
    "/api/admin/lesson-templates/:id/content",
    authRequired,
    adminRequired,
    async (_req: AuthenticatedRequest, res) => {
      const req = _req;
      const id = String(req.params.id);
      const parsed = z
        .object({
          studentSummary: z.string().max(8000).optional().nullable(),
          lessonContent: lessonContentZ.optional().nullable()
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const exists = await prisma.lessonTemplate.findFirst({
        where: { id, published: true },
        select: { id: true }
      });
      if (!exists) {
        res.status(404).json({ error: "Lesson not found" });
        return;
      }
      await prisma.lessonTemplate.update({
        where: { id },
        data: {
          ...(parsed.data.studentSummary !== undefined
            ? { studentSummary: parsed.data.studentSummary }
            : {}),
          ...(parsed.data.lessonContent !== undefined
            ? {
                lessonContent:
                  parsed.data.lessonContent === null
                    ? Prisma.JsonNull
                    : (parsed.data.lessonContent as Prisma.InputJsonValue)
              }
            : {})
        }
      });
      res.json({ ok: true });
    }
  );

  app.delete(
    "/api/admin/lesson-templates/:id",
    authRequired,
    adminRequired,
    async (_req: AuthenticatedRequest, res) => {
      const req = _req;
      const id = String(req.params.id);
      const exists = await prisma.lessonTemplate.findUnique({
        where: { id },
        select: { id: true }
      });
      if (!exists) {
        res.status(404).json({ error: "Lesson not found" });
        return;
      }
      try {
        await prisma.lessonTemplate.delete({ where: { id } });
        res.json({ ok: true });
      } catch {
        res.status(409).json({
          error:
            "Нельзя удалить урок: он уже используется в расписании, заданиях или связанном контенте. Сначала отвяжи его."
        });
      }
    }
  );

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
          studentSummary: true,
          lessonContent: true
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
          studentSummary: true,
          lessonContent: true
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
          lessonTemplate: { select: { id: true, title: true } },
          slotAssignments: {
            where: { published: true, kind: { in: [...assignmentKindsLmsZ] } },
            select: { id: true, title: true, kind: true, dueAt: true }
          }
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
            weeklySeriesId: s.weeklySeriesId,
            linkedAssignments: sortLinkedAssignmentsByKind(s.slotAssignments).map((a) => ({
              id: a.id,
              title: a.title,
              kind: a.kind,
              dueAt: a.dueAt?.toISOString() ?? null
            }))
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
          repeatWeeks: z.coerce.number().int().min(1).max(52).optional(),
          attachClasswork: z.boolean().optional(),
          addHomework: z.boolean().optional(),
          homeworkDueAt: z.string().datetime().optional().nullable(),
          homeworkDueDaysAfterLesson: z.coerce.number().int().min(0).max(28).optional(),
          classworkTitle: z.string().max(240).optional().nullable(),
          homeworkTitle: z.string().max(240).optional().nullable(),
          classworkDescription: z.string().max(4000).optional().nullable(),
          homeworkDescription: z.string().max(4000).optional().nullable()
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
      const attachClasswork = parsed.data.attachClasswork === true;
      const addHomework = parsed.data.addHomework === true;
      if (addHomework && repeatWeeks === 1 && !parsed.data.homeworkDueAt) {
        res.status(400).json({ error: "Укажи срок сдачи домашнего задания" });
        return;
      }
      const homeworkDaysAfter = parsed.data.homeworkDueDaysAfterLesson ?? 7;
      const weeklySeriesId = repeatWeeks > 1 ? randomUUID() : null;
      const catalogLessonId = parsed.data.lessonTemplateId ?? null;
      const slotLessonTemplateId = repeatWeeks > 1 ? null : catalogLessonId;
      const notes = parsed.data.notes ?? null;
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const batch: {
        id: string;
        classroomId: string;
        startsAt: Date;
        endsAt: Date;
        durationMinutes: number;
        lessonTemplateId: string | null;
        notes: string | null;
        weeklySeriesId: string | null;
      }[] = [];
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
          lessonTemplateId: slotLessonTemplateId,
          notes,
          weeklySeriesId
        });
      }
      if (addHomework) {
        for (const row of batch) {
          const due =
            repeatWeeks === 1
              ? new Date(parsed.data.homeworkDueAt!)
              : homeworkDueAfterLessonDays(row.startsAt, homeworkDaysAfter);
          const dueErr = assertDueAtInFuture(due);
          if (dueErr) {
            res.status(400).json({
              error:
                repeatWeeks > 1
                  ? `${dueErr} Уменьши число дней до сдачи после занятия или сократи серию.`
                  : dueErr
            });
            return;
          }
        }
      }
      let lessonTitleForAuto: string | null = null;
      let templateSnapshot: Prisma.InputJsonValue = EMPTY_SNAPSHOT;
      if (catalogLessonId) {
        const ltMeta = await prisma.lessonTemplate.findFirst({
          where: { id: catalogLessonId, published: true, moduleKey },
          select: { title: true, starterPayload: true }
        });
        if (ltMeta) {
          lessonTitleForAuto = ltMeta.title;
          templateSnapshot = ltMeta.starterPayload as Prisma.InputJsonValue;
        }
      }
      const classworkTitleTrim = parsed.data.classworkTitle?.trim() ?? "";
      const homeworkTitleTrim = parsed.data.homeworkTitle?.trim() ?? "";
      const ownerId = req.session!.sub;
      const notifyTitles: string[] = [];
      await prisma.$transaction(async (tx) => {
        await tx.classScheduleSlot.createMany({ data: batch });
        for (const row of batch) {
          if (attachClasswork) {
            const title =
              classworkTitleTrim ||
              (lessonTitleForAuto ? `Классная работа: ${lessonTitleForAuto}` : "Классная работа");
            await tx.assignment.create({
              data: {
                classroomId,
                ownerId,
                scheduleSlotId: row.id,
                title,
                description: parsed.data.classworkDescription?.trim() || null,
                kind: "classwork",
                maxScore: 10,
                published: true,
                templateSnapshot,
                lessonTemplateId: catalogLessonId,
                dueAt: null
              }
            });
            notifyTitles.push(title);
          }
          if (addHomework) {
            const due =
              repeatWeeks === 1
                ? new Date(parsed.data.homeworkDueAt!)
                : homeworkDueAfterLessonDays(row.startsAt, homeworkDaysAfter);
            const title =
              homeworkTitleTrim || (lessonTitleForAuto ? `ДЗ: ${lessonTitleForAuto}` : "ДЗ");
            await tx.assignment.create({
              data: {
                classroomId,
                ownerId,
                scheduleSlotId: row.id,
                title,
                description: parsed.data.homeworkDescription?.trim() || null,
                kind: "homework",
                maxScore: 10,
                published: true,
                templateSnapshot,
                lessonTemplateId: catalogLessonId,
                dueAt: due
              }
            });
            notifyTitles.push(title);
          }
        }
      });
      if (repeatWeeks === 1) {
        for (const t of notifyTitles) {
          void notifyEnrolledStudentsNewAssignment(classroomId, t);
        }
      }
      res.json({
        ids: batch.map((b) => b.id),
        weeklySeriesId,
        count: batch.length,
        assignmentsCreated: notifyTitles.length
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
          const rawMins = (end.getTime() - nextStart.getTime()) / 60_000;
          if (rawMins <= 0) {
            res.status(400).json({ error: "Время окончания должно быть позже начала" });
            return;
          }
          durationMinutes = clampDurationMinutes(rawMins);
        }
      }
      const timeFieldsChanged =
        parsed.data.startsAt !== undefined ||
        (parsed.data.durationMinutes != null && !Number.isNaN(parsed.data.durationMinutes)) ||
        Boolean(parsed.data.endsAt);
      if (parsed.data.startsAt !== undefined) {
        const prevNorm = toMinutePrecisionStart(slot.startsAt.toISOString());
        const startMoved = nextStart.getTime() !== prevNorm.getTime();
        if (startMoved) {
          const pastErr = assertScheduleStartNotInPast(nextStart);
          if (pastErr) {
            res.status(400).json({ error: pastErr });
            return;
          }
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
          lessonTemplate: { select: { id: true, title: true } },
          slotAssignments: {
            where: { published: true, kind: { in: [...assignmentKindsLmsZ] } },
            select: { id: true, title: true, kind: true, dueAt: true }
          }
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
            myPlansToAttend: attBySlot.get(s.id) ?? null,
            linkedAssignments: sortLinkedAssignmentsByKind(s.slotAssignments).map((a) => ({
              id: a.id,
              title: a.title,
              kind: a.kind,
              dueAt: a.dueAt?.toISOString() ?? null
            }))
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
          published: z.boolean().optional(),
          lessonContent: lessonContentZ.optional()
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
          published: parsed.data.published ?? true,
          ...(parsed.data.lessonContent !== undefined
            ? { lessonContent: parsed.data.lessonContent as Prisma.InputJsonValue }
            : {})
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
        where: { classroomId, kind: { in: [...assignmentKindsLmsZ] } },
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

  app.delete(
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
      const c = await assertTeacherClassroom(req.session!.sub, a.classroomId);
      if (!c) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      await prisma.lessonPlayerProgress.deleteMany({
        where: a.lessonTemplateId
          ? { scopeKey: assignmentId, lessonTemplateId: a.lessonTemplateId }
          : { scopeKey: assignmentId }
      });
      await prisma.assignment.delete({ where: { id: assignmentId } });
      res.json({ ok: true });
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
      const studentIdFilter = typeof req.query.studentId === "string" ? req.query.studentId : undefined;
      if (studentIdFilter) {
        const enrolled = await prisma.enrollment.findFirst({
          where: { classroomId, studentId: studentIdFilter }
        });
        if (!enrolled) {
          res.status(400).json({ error: "Ученик не в этом классе" });
          return;
        }
      }
      const classworkAssignments = await prisma.assignment.findMany({
        where: { classroomId, kind: "classwork", published: true },
        select: { id: true }
      });
      const enrollRows = await prisma.enrollment.findMany({
        where: { classroomId },
        select: { studentId: true }
      });
      if (classworkAssignments.length > 0 && enrollRows.length > 0) {
        const draftSubs = enrollRows.flatMap((e) =>
          classworkAssignments.map((a) => ({
            assignmentId: a.id,
            studentId: e.studentId,
            status: "not_started" as const
          }))
        );
        await prisma.submission.createMany({ data: draftSubs, skipDuplicates: true });
      }
      const where: Prisma.SubmissionWhereInput = {
        assignment: { classroomId, kind: { in: [...assignmentKindsLmsZ] } }
      };
      if (assignmentId) {
        where.assignmentId = assignmentId;
      }
      if (studentIdFilter) {
        where.studentId = studentIdFilter;
      }
      const list = await prisma.submission.findMany({
        where,
        include: {
          student: { select: { id: true, nickname: true, email: true } },
          assignment: { select: { id: true, title: true, maxScore: true, kind: true, lessonTemplateId: true } }
        },
        orderBy: { updatedAt: "desc" }
      });
      res.json(
        list.map((s) => ({
          id: s.id,
          status: s.status,
          score: s.score,
          autoScore: s.autoScore,
          manualScore: s.manualScore,
          scoreBreakdown: s.scoreBreakdown,
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
            manualScore: null,
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
            manualScore: sub.autoScore != null ? Math.max(0, sc - sub.autoScore) : sc,
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
          status: { in: ["submitted", "pending_teacher_review"] },
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
          where: { classroomId, published: true, kind: { in: [...assignmentKindsLmsZ] } },
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
              where: { published: true, kind: { in: [...assignmentKindsLmsZ] } },
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
      scheduleSlotId: string | null;
      lessonTemplateId: string | null;
      submission: {
        id: string;
        status: string;
        score: number | null;
        autoScore: number | null;
        manualScore: number | null;
        scoreBreakdown: unknown;
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
          scheduleSlotId: a.scheduleSlotId,
          lessonTemplateId: a.lessonTemplateId,
          submission: sub
            ? {
                id: sub.id,
                status: sub.status,
                score: sub.score,
                autoScore: sub.autoScore,
                manualScore: sub.manualScore,
                scoreBreakdown: sub.scoreBreakdown,
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

  app.get(
    "/api/student/direct/block-progress",
    authRequired,
    roleGuard(["student"]),
    async (req: AuthenticatedRequest, res) => {
      const student = await prisma.user.findUnique({
        where: { id: req.session!.sub },
        select: { studentMode: true }
      });
      if (!student || student.studentMode !== "direct") {
        res.json({ threshold: 80, modules: [] });
        return;
      }
      const lessons = await prisma.lessonTemplate.findMany({
        where: { published: true },
        orderBy: [{ moduleKey: "asc" }, { sortOrder: "asc" }],
        select: { id: true, title: true, moduleKey: true, lessonContent: true }
      });
      const progress = await prisma.lessonPlayerProgress.findMany({
        where: { userId: req.session!.sub, scopeKey: "direct" },
        select: { lessonTemplateId: true, state: true }
      });
      const stateByLesson = new Map(progress.map((p) => [p.lessonTemplateId, p.state]));
      const moduleMap = new Map<string, { id: string; score: number }[]>();
      for (const lesson of lessons) {
        const checkpointIds = lessonCheckpointIds(lesson.lessonContent);
        const stateRaw = stateByLesson.get(lesson.id);
        const state =
          stateRaw && typeof stateRaw === "object"
            ? (stateRaw as { checkpoints?: Record<string, string> })
            : null;
        const checkpoints = state?.checkpoints ?? {};
        let score = 100;
        if (checkpointIds.length > 0) {
          const done = checkpointIds.filter((id) => checkpoints[id] === "ok").length;
          score = Math.round((done / checkpointIds.length) * 100);
        }
        const arr = moduleMap.get(lesson.moduleKey) ?? [];
        arr.push({ id: lesson.id, score });
        moduleMap.set(lesson.moduleKey, arr);
      }
      const modules = [...moduleMap.entries()].map(([moduleKey, rows], idx) => {
        const avgScore =
          rows.length > 0 ? Math.round(rows.reduce((acc, r) => acc + r.score, 0) / rows.length) : 0;
        const passed = avgScore >= 80;
        const prev = idx > 0 ? [...moduleMap.entries()][idx - 1] : null;
        const prevPassed = !prev
          ? true
          : Math.round(prev[1].reduce((acc, r) => acc + r.score, 0) / Math.max(1, prev[1].length)) >= 80;
        return { moduleKey, avgScore, passed, unlocked: prevPassed };
      });
      res.json({ threshold: 80, modules });
    }
  );

  app.post(
    "/api/student/assignments/:assignmentId/start",
    authRequired,
    roleGuard(["student"]),
    async (req: AuthenticatedRequest, res) => {
      const assignmentId = String(req.params.assignmentId);
      const studentId = req.session!.sub;
      const assignment = await prisma.assignment.findFirst({
        where: { id: assignmentId, published: true, kind: { in: [...assignmentKindsLmsZ] } }
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
      const student = await prisma.user.findUnique({
        where: { id: studentId },
        select: { studentMode: true }
      });
      if (!student) {
        res.status(404).json({ error: "Student not found" });
        return;
      }
      const sub = await prisma.submission.findUnique({
        where: { assignmentId_studentId: { assignmentId, studentId } },
        include: { assignment: { include: { lessonTemplate: { select: { lessonContent: true } } } } }
      });
      if (!sub) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      const tasksForSubmitGate = summarizeHomeworkTasks(sub.assignment.lessonTemplate?.lessonContent);
      let lessonProgressForSubmit: { state: unknown } | null = null;
      if (sub.assignment.lessonTemplateId) {
        lessonProgressForSubmit = await prisma.lessonPlayerProgress.findUnique({
          where: {
            userId_lessonTemplateId_scopeKey: {
              userId: studentId,
              lessonTemplateId: sub.assignment.lessonTemplateId,
              scopeKey: sub.assignmentId
            }
          },
          select: { state: true }
        });
      }
      const miniState = lessonProgressForSubmit?.state as
        | { miniDevProjectIds?: Record<string, string | undefined> }
        | undefined;
      const miniMap = miniState?.miniDevProjectIds ?? {};
      const minisCoverLessonStudios =
        Boolean(sub.assignment.lessonTemplateId) &&
        tasksForSubmitGate.projectCount > 0 &&
        tasksForSubmitGate.studioBlockIds.length === tasksForSubmitGate.projectCount &&
        tasksForSubmitGate.studioBlockIds.every((id) => Boolean(miniMap[id]?.trim()));
      if (!sub.projectId) {
        if (tasksForSubmitGate.projectCount > 0 && !minisCoverLessonStudios) {
          res.status(400).json({ error: "Start assignment first" });
          return;
        }
      }
      const en = await assertStudentInClassroom(studentId, sub.assignment.classroomId);
      if (!en) {
        res.status(403).json({ error: "Not enrolled" });
        return;
      }
      if (sub.status === "submitted" || sub.status === "pending_teacher_review") {
        res.status(400).json({ error: "Работа уже сдана. Дождитесь проверки учителя." });
        return;
      }
      if (sub.status !== "draft" && sub.status !== "needs_revision") {
        res.status(400).json({ error: "Сдать работу сейчас нельзя" });
        return;
      }
      const now = new Date();
      let nextStatus: "submitted" | "auto_checked" | "pending_teacher_review" = "submitted";
      let nextScore: number | null = null;
      let autoScore: number | null = null;
      let manualScore: number | null = null;
      let scoreBreakdown: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
      if (sub.assignment.kind === "homework") {
        const tasks = tasksForSubmitGate;
        const auto = computeHomeworkAutoPart(sub.assignment.maxScore, tasks, lessonProgressForSubmit?.state);
        autoScore = auto.autoScore;
        const needsTeacherManual = student.studentMode === "school" && auto.manualMax > 0;
        if (needsTeacherManual) {
          nextStatus = "pending_teacher_review";
          nextScore = null;
          manualScore = null;
        } else {
          nextStatus = "auto_checked";
          nextScore = autoScore;
          manualScore = Math.max(0, sub.assignment.maxScore - autoScore);
        }
        scoreBreakdown = {
          weights: {
            auto: auto.autoMax,
            manual: auto.manualMax
          },
          tasks: {
            testCount: tasks.testCount,
            openCount: tasks.openCount,
            projectCount: tasks.projectCount
          },
          testSolved: auto.solvedTests
        } as Prisma.InputJsonValue;
      }
      await prisma.submission.update({
        where: { id: sub.id },
        data: {
          status: nextStatus,
          submittedAt: now,
          gradedAt: nextStatus === "auto_checked" ? now : null,
          score: nextScore,
          autoScore,
          manualScore,
          scoreBreakdown,
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
      if (nextStatus === "submitted" || nextStatus === "pending_teacher_review") {
        if (teacher?.email && studentNick) {
        const appUrl = `${config.appBaseUrl.replace(/\/$/, "")}/teacher`;
        void sendTeacherSubmissionEmail(teacher.email, {
          studentNickname: studentNick.nickname,
          assignmentTitle: sub.assignment.title,
          appUrl
        }).catch(() => {});
        }
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
        autoScore: sub.autoScore,
        manualScore: sub.manualScore,
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
          autoScore: sub.autoScore,
          manualScore: sub.manualScore,
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

  app.get(
    "/api/student/lessons/:lessonId/player-bootstrap",
    authRequired,
    roleGuard(["student", "admin"]),
    async (req: AuthenticatedRequest, res) => {
      const lessonId = String(req.params.lessonId);
      const assignmentIdRaw = req.query.assignmentId;
      const assignmentId =
        typeof assignmentIdRaw === "string" && assignmentIdRaw.length > 0 ? assignmentIdRaw : null;

      const lesson = await prisma.lessonTemplate.findFirst({
        where: { id: lessonId, published: true },
        select: { id: true, title: true, studentSummary: true, lessonContent: true }
      });
      if (!lesson) {
        res.status(404).json({ error: "Урок не найден" });
        return;
      }

      let scopeKey = "direct";
      let assignmentTitle: string | null = null;
      let assignmentKind: string | null = null;
      let submissionSummary: {
        id: string;
        status: string;
        projectId: string | null;
        canSubmit: boolean;
      } | null = null;
      if (assignmentId) {
        const sub = await prisma.submission.findFirst({
          where: { studentId: req.session!.sub, assignmentId },
          include: { assignment: { select: { lessonTemplateId: true, title: true, kind: true } } }
        });
        if (!sub || sub.assignment.lessonTemplateId !== lessonId) {
          res.status(403).json({ error: "Нет доступа к этому заданию или урок не совпадает" });
          return;
        }
        scopeKey = assignmentId;
        assignmentTitle = sub.assignment.title;
        assignmentKind = sub.assignment.kind;
        submissionSummary = {
          id: sub.id,
          status: sub.status,
          projectId: sub.projectId,
          canSubmit: sub.status === "draft" || sub.status === "needs_revision"
        };
      }

      const progress = await prisma.lessonPlayerProgress.findUnique({
        where: {
          userId_lessonTemplateId_scopeKey: {
            userId: req.session!.sub,
            lessonTemplateId: lessonId,
            scopeKey
          }
        }
      });

      res.json({
        title: lesson.title,
        studentSummary: lesson.studentSummary,
        lessonContent: lesson.lessonContent,
        scopeKey,
        assignmentTitle,
        assignmentKind,
        submission: submissionSummary,
        state: progress?.state ?? {}
      });
    }
  );

  app.get(
    "/api/teacher/lessons/:lessonId/player-review-bootstrap",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const lessonId = String(req.params.lessonId);
      const submissionIdRaw = req.query.submissionId;
      const submissionId =
        typeof submissionIdRaw === "string" && submissionIdRaw.length > 0 ? submissionIdRaw : "";
      if (!submissionId) {
        res.status(400).json({ error: "Нужен submissionId" });
        return;
      }
      const sub = await prisma.submission.findFirst({
        where: { id: submissionId },
        include: {
          student: { select: { nickname: true } },
          assignment: {
            select: {
              id: true,
              lessonTemplateId: true,
              ownerId: true,
              title: true,
              maxScore: true,
              kind: true
            }
          }
        }
      });
      if (!sub || sub.assignment.ownerId !== req.session!.sub) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (sub.assignment.lessonTemplateId !== lessonId) {
        res.status(400).json({ error: "Урок не совпадает с заданием" });
        return;
      }
      const lesson = await prisma.lessonTemplate.findFirst({
        where: { id: lessonId, published: true },
        select: { id: true, title: true, studentSummary: true, lessonContent: true }
      });
      if (!lesson) {
        res.status(404).json({ error: "Урок не найден" });
        return;
      }
      const progress = await prisma.lessonPlayerProgress.findUnique({
        where: {
          userId_lessonTemplateId_scopeKey: {
            userId: sub.studentId,
            lessonTemplateId: lessonId,
            scopeKey: sub.assignmentId
          }
        }
      });
      res.json({
        title: lesson.title,
        studentSummary: lesson.studentSummary,
        lessonContent: lesson.lessonContent,
        scopeKey: sub.assignmentId,
        assignmentTitle: sub.assignment.title,
        assignmentKind: sub.assignment.kind,
        state: progress?.state ?? {},
        review: {
          submissionId: sub.id,
          studentNickname: sub.student.nickname,
          status: sub.status,
          score: sub.score,
          maxScore: sub.assignment.maxScore,
          autoScore: sub.autoScore,
          manualScore: sub.manualScore,
          teacherNote: sub.teacherNote,
          revisionNote: sub.revisionNote
        }
      });
    }
  );

  app.get(
    "/api/teacher/submissions/:submissionId/projects/:projectId/for-review",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const submissionId = String(req.params.submissionId);
      const projectId = String(req.params.projectId);
      const sub = await prisma.submission.findFirst({
        where: { id: submissionId },
        include: { assignment: true }
      });
      if (!sub || sub.assignment.ownerId !== req.session!.sub) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const p = await prisma.project.findFirst({
        where: { id: projectId },
        include: { snapshot: true }
      });
      if (!p?.snapshot) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (p.userId !== sub.studentId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const ltId = sub.assignment.lessonTemplateId;
      const allowed = p.id === sub.projectId || (ltId != null && p.lessonTemplateId === ltId);
      if (!allowed) {
        res.status(403).json({ error: "Проект не привязан к этой сдаче" });
        return;
      }
      res.json({
        meta: {
          id: p.id,
          userId: p.userId,
          title: p.title,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
          readOnly: true as const
        },
        snapshot: p.snapshot.payload
      });
    }
  );

  app.post(
    "/api/student/lessons/:lessonId/mini-dev-project",
    authRequired,
    roleGuard(["student", "admin"]),
    async (req: AuthenticatedRequest, res) => {
      const lessonId = String(req.params.lessonId);
      const assignmentIdRaw = req.query.assignmentId;
      const assignmentId =
        typeof assignmentIdRaw === "string" && assignmentIdRaw.length > 0 ? assignmentIdRaw : null;

      const body = z
        .object({
          blockId: z.string().min(1),
          title: z.string().min(1).optional()
        })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: body.error.message });
        return;
      }

      if (assignmentId) {
        const sub = await prisma.submission.findFirst({
          where: { studentId: req.session!.sub, assignmentId },
          include: { assignment: { select: { lessonTemplateId: true } } }
        });
        if (!sub || sub.assignment.lessonTemplateId !== lessonId) {
          res.status(403).json({ error: "Нет доступа к этому заданию или урок не совпадает" });
          return;
        }
      }

      const lesson = await prisma.lessonTemplate.findFirst({
        where: { id: lessonId, published: true },
        select: { id: true, title: true, lessonContent: true, starterPayload: true }
      });
      if (!lesson) {
        res.status(404).json({ error: "Урок не найден" });
        return;
      }

      const blocks = lessonFlowBlocksFromContent(lesson.lessonContent);
      const block = blocks.find(
        (b) => typeof b === "object" && b !== null && (b as { id?: string }).id === body.data.blockId
      );
      if (!block) {
        res.status(400).json({ error: "Блок с таким id не найден в уроке" });
        return;
      }

      let parsed: MiniPracticeParsed;
      try {
        const p = parseMiniStudioBlock(block);
        if (!p) {
          res.status(400).json({ error: "Это не блок мини-разработки" });
          return;
        }
        parsed = p;
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : "Ошибка настройки блока" });
        return;
      }

      let snapshotPayload: Record<string, unknown>;
      if (parsed.kind === "template") {
        snapshotPayload = normalizeProjectSnapshotPayload(lesson.starterPayload);
      } else if (parsed.kind === "empty") {
        const tabularDatasets =
          lesson.id === "lt_module_a_keeper_quest"
            ? irisQuestMiniTabularDatasets()
            : [irisTabularDatasetEntryFromPublicCsv()];
        snapshotPayload = {
          ...cloneJson(EMPTY_MINI_PROJECT_SNAPSHOT),
          workspaceLevel: parsed.workspaceLevel,
          tabularDatasets
        };
      } else {
        const ref = await prisma.project.findFirst({
          where: { id: parsed.referenceProjectId },
          include: { snapshot: true }
        });
        if (!ref?.snapshot?.payload) {
          res.status(400).json({
            error:
              "Проект-образец не найден. Создайте проект в «Разработка», сохраните в облако и проверьте id в блоке урока."
          });
          return;
        }
        snapshotPayload = normalizeProjectSnapshotPayload(ref.snapshot.payload);
      }

      const projectId = `p_${randomBytes(12).toString("hex")}`;
      const title = body.data.title?.trim() || `${lesson.title} · мини`;

      await prisma.project.create({
        data: {
          id: projectId,
          userId: req.session!.sub,
          title,
          lessonTemplateId: lessonId,
          snapshot: {
            create: { payload: snapshotPayload as Prisma.InputJsonValue }
          }
        }
      });

      res.json({ projectId });
    }
  );

  app.patch(
    "/api/student/lessons/:lessonId/player-progress",
    authRequired,
    roleGuard(["student", "admin"]),
    async (req: AuthenticatedRequest, res) => {
      const lessonId = String(req.params.lessonId);
      const parsed = z.object({ state: z.record(z.string(), z.unknown()) }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      if (JSON.stringify(parsed.data.state).length > 48000) {
        res.status(400).json({ error: "Слишком большой state" });
        return;
      }

      const assignmentIdRaw = req.query.assignmentId;
      const assignmentId =
        typeof assignmentIdRaw === "string" && assignmentIdRaw.length > 0 ? assignmentIdRaw : null;

      const exists = await prisma.lessonTemplate.findFirst({
        where: { id: lessonId, published: true },
        select: { id: true }
      });
      if (!exists) {
        res.status(404).json({ error: "Урок не найден" });
        return;
      }

      let scopeKey = "direct";
      if (assignmentId) {
        const sub = await prisma.submission.findFirst({
          where: { studentId: req.session!.sub, assignmentId },
          include: { assignment: { select: { lessonTemplateId: true } } }
        });
        if (!sub || sub.assignment.lessonTemplateId !== lessonId) {
          res.status(403).json({ error: "Нет доступа" });
          return;
        }
        scopeKey = assignmentId;
      }

      await prisma.lessonPlayerProgress.upsert({
        where: {
          userId_lessonTemplateId_scopeKey: {
            userId: req.session!.sub,
            lessonTemplateId: lessonId,
            scopeKey
          }
        },
        create: {
          userId: req.session!.sub,
          lessonTemplateId: lessonId,
          scopeKey,
          state: parsed.data.state as Prisma.InputJsonValue
        },
        update: { state: parsed.data.state as Prisma.InputJsonValue }
      });
      res.json({ ok: true });
    }
  );

  app.get(
    "/api/teacher/classrooms/:classroomId/lesson-player-progress",
    authRequired,
    roleGuard(["teacher"]),
    async (req: AuthenticatedRequest, res) => {
      const classroomId = String(req.params.classroomId);
      const lessonTemplateIdFilter = req.query.lessonTemplateId
        ? String(req.query.lessonTemplateId)
        : null;

      const room = await assertTeacherClassroom(req.session!.sub, classroomId);
      if (!room) {
        res.status(404).json({ error: "Класс не найден" });
        return;
      }

      const assignments = await prisma.assignment.findMany({
        where: {
          classroomId,
          lessonTemplateId: lessonTemplateIdFilter ?? { not: null }
        },
        select: { id: true, title: true, lessonTemplateId: true }
      });
      const scopeKeys = assignments.map((a) => a.id);
      if (scopeKeys.length === 0) {
        res.json({ assignments: [], progress: [] });
        return;
      }

      const progressRows = await prisma.lessonPlayerProgress.findMany({
        where: { scopeKey: { in: scopeKeys } },
        include: { user: { select: { id: true, nickname: true } } }
      });

      const assignmentById = new Map(assignments.map((a) => [a.id, a]));
      res.json({
        assignments,
        progress: progressRows.map((p) => ({
          studentId: p.userId,
          studentNickname: p.user.nickname,
          assignmentId: p.scopeKey,
          assignmentTitle: assignmentById.get(p.scopeKey)?.title ?? null,
          lessonTemplateId: p.lessonTemplateId,
          state: p.state,
          updatedAt: p.updatedAt.toISOString()
        }))
      });
    }
  );
}

const LESSON_GUIDE_SEED: Record<string, { teacherGuideMd: string; studentSummary: string }> = {
  lt_intro_ai: {
    studentSummary:
      "Квест с Хранителем историй: как ИИ учится на данных, где он помогает в жизни и как собрать свою первую мини-модель в Nodly.",
    teacherGuideMd: `# Методичка: урок 1 — Модуль A «Архив ИИ: дело Хранителя»

## Формат
- Презентация-квест (режим deck), не лента.
- Возраст: школьники с нуля.
- Длительность: 60 минут.

## Цели урока
- Снять страх перед словом «ИИ» через жизненные примеры.
- Понять базовую цепочку: данные → обучение → предсказание.
- Объяснить разницу между обучающей и тестовой выборкой.
- Показать переобучение/недообучение на понятных аналогиях.
- Дать мини-практику в Nodly (блоки + запуск модели).

## Тайминг (60 минут)
1. Вступление и сюжет квеста (7 мин).
2. Где ИИ в жизни и почему данные важны (15 мин).
3. Как учится модель: шаги и ошибки (15 мин).
4. Мини-разработка в Nodly (18 мин).
5. Рефлексия и завершение миссии (5 мин).

## Подсказки учителю
- Чаще задавай короткие вопросы в зал: «Как думаете, откуда модель это знает?»
- После каждого важного слайда делай мини-паузу на обсуждение 20-30 секунд.
- На практике не требуй идеального результата: важнее пройти весь цикл.
- Если класс сильный, добавь обсуждение fairness и качества разметки.
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

const LESSON_CONTENT_SEED: Record<string, Prisma.InputJsonValue> = {
  lt_intro_ai: {
    schemaVersion: 2,
    blocks: [
      {
        id: "a_intro_title",
        type: "text",
        textScale: "lg",
        body:
          "# Модуль A: Архив ИИ\n\n**Квест:** вместе с Хранителем историй раскроем, как ИИ помогает людям каждый день."
      },
      {
        id: "a_intro_guard",
        type: "media",
        kind: "image",
        url: "/api/coach/idle.png",
        caption: "Хранитель историй ИИ"
      },
      {
        id: "a_intro_mission",
        type: "text",
        body:
          "## Миссия на урок\n- Найти 3 ключа: **данные**, **обучение**, **проверка**\n- Разобраться, почему ИИ ошибается\n- Собрать свою первую мини-модель в Nodly"
      },
      {
        id: "a_hook_q",
        type: "checkpoint",
        question: "Что из этого точнее описывает ИИ?",
        answerMode: "single",
        options: [
          "Магия без правил",
          "Программа, которая учится на данных",
          "База случайных ответов"
        ],
        expectedAnswer: "Программа, которая учится на данных"
      },
      {
        id: "a_everyday_ai",
        type: "text",
        body:
          "## Улика 1: ИИ уже рядом\n- Рекомендации в YouTube, TikTok, Netflix\n- Голосовые помощники\n- Фильтры и распознавание лица\n- Игровые NPC и подбор сложности"
      },
      {
        id: "a_fact_stream",
        type: "text",
        body:
          "### Факты\n- На YouTube загружают сотни часов видео каждую минуту\n- Человек не сможет это разобрать вручную\n- ИИ ищет похожие паттерны в поведении зрителей"
      },
      {
        id: "a_voice_face_game",
        type: "text",
        body:
          "## Как это работает внутри\n1. Система получает данные (звук/фото/клики)\n2. Находит закономерности\n3. Делает предположение\n4. Улучшается на новых примерах"
      },
      {
        id: "a_ai_definition",
        type: "text",
        body:
          "## Что такое ИИ\n**ИИ — это не человек и не магия.**\nЭто алгоритм, который:\n- учится на примерах;\n- замечает повторяющиеся связи;\n- выдает предсказание с вероятностью."
      },
      {
        id: "a_data_food",
        type: "text",
        body:
          "## Улика 2: данные — топливо ИИ\nБез данных модель не учится, как ученик без задачника.\n\nНужны:\n- разнообразие примеров;\n- корректные подписи (разметка);\n- достаточный объем."
      },
      {
        id: "a_data_types",
        type: "text",
        body:
          "### Какие бывают данные\n- **Изображения**: лица, объекты, медицина\n- **Текст**: перевод, чат-боты\n- **Звук**: помощники, субтитры\n- **Таблицы**: прогнозы и аналитика"
      },
      {
        id: "a_split_text",
        type: "text",
        body:
          "## Улика 3: деление датасета\n- **80% обучающая выборка**: модель учится\n- **20% тестовая выборка**: честная проверка\n\nЕсли тест показать заранее, модель просто запомнит ответы."
      },
      {
        id: "a_train_pipeline",
        type: "text",
        body:
          "## Как учится модель\n1. Собрали и разметили данные\n2. Обучили модель\n3. Проверили на новых примерах\n4. Улучшили набор данных\n5. Повторили цикл"
      },
      {
        id: "a_loss_text",
        type: "text",
        body:
          "## Что такое Loss\n**Loss** показывает, насколько модель ошиблась.\n\n- Больше Loss -> хуже\n- Меньше Loss -> лучше\n\nВо время обучения цель — уменьшать Loss шаг за шагом."
      },
      {
        id: "a_under_overfit",
        type: "text",
        body:
          "## Недообучение и переобучение\n- **Недообучение**: модель слишком простая, не уловила паттерны\n- **Переобучение**: модель заучила тренировку и слаба на новых данных\n\nНужен баланс: не слишком просто и не слишком сложно."
      },
      {
        id: "a_quiz_split",
        type: "checkpoint",
        question: "Зачем нужна тестовая выборка?",
        answerMode: "single",
        options: [
          "Чтобы увеличить скорость интернета",
          "Чтобы честно проверить модель на новых данных",
          "Чтобы украсить проект"
        ],
        expectedAnswer: "Чтобы честно проверить модель на новых данных"
      },
      {
        id: "a_quiz_overfit",
        type: "checkpoint",
        question: "Что значит переобучение?",
        answerMode: "single",
        options: [
          "Модель не видела обучающие данные",
          "Модель идеально запомнила тренировочные примеры, но плохо обобщает",
          "Модель не умеет предсказывать вообще"
        ],
        expectedAnswer: "Модель идеально запомнила тренировочные примеры, но плохо обобщает"
      },
      {
        id: "a_quiz_loss",
        type: "checkpoint",
        question: "Что показывает метрика Loss?",
        answerMode: "single",
        options: [
          "Количество картинок в датасете",
          "Размер модели в мегабайтах",
          "Насколько модель ошибается"
        ],
        expectedAnswer: "Насколько модель ошибается"
      },
      {
        id: "a_minidev_intro",
        type: "text",
        body:
          "## Мини-разработка: Первый запуск ИИ в Nodly\nСобери цепочку из блоков и запусти мини-эксперимент.\n\nЦель: пройти путь **данные -> обучение -> предсказание**."
      },
      {
        id: "a_minidev_studio",
        type: "studio",
        instruction:
          "Собери базовый pipeline: Старт -> Обучить модель -> Предсказать. Выбери датасет, запусти обучение и сделай хотя бы одно предсказание.",
        ctaAction: null,
        studioPracticeKind: "empty",
        studioWorkspaceLevel: 1,
        goals: [
          {
            id: "a_goal_dataset",
            title: "Выбери image-датасет",
            type: "select_dataset",
            datasetKind: "image"
          },
          {
            id: "a_goal_train_block",
            title: "Добавь блок «Обучить модель»",
            type: "add_block",
            blockType: "noda_train_model_simple"
          },
          {
            id: "a_goal_train",
            title: "Запусти обучение модели",
            type: "train_model"
          },
          {
            id: "a_goal_predict",
            title: "Сделай предсказание",
            type: "run_prediction"
          }
        ]
      },
      {
        id: "a_reflect_q",
        type: "checkpoint",
        question: "Коротко: почему качество данных влияет на качество предсказания?",
        answerMode: "text",
        expectedAnswer: "Модель учится на данных: плохие или несбалансированные данные дают плохие предсказания."
      },
      {
        id: "a_finish_text",
        type: "text",
        textScale: "lg",
        body:
          "## Миссия выполнена\nТы уже умеешь:\n- объяснить, как ИИ учится;\n- отличать обучающую и тестовую выборки;\n- запускать мини-модель в Nodly.\n\nДальше — еще больше практики в модуле A."
      },
      {
        id: "a_finish_media",
        type: "media",
        kind: "image",
        url: "/api/coach/success.png",
        caption: "Хранитель: отличная работа, агент ИИ!"
      }
    ],
    deck: {
      schemaVersion: 1,
      slides: [
        {
          id: "a_s_01",
          title: "Пролог",
          elements: [
            {
              id: "a_e_01",
              layout: { x: 6, y: 8, w: 56, h: 22 },
              zIndex: 1,
              block: { id: "a_intro_title", type: "text", textScale: "lg", body: "# Модуль A: Архив ИИ\n\n**Квест:** вместе с Хранителем историй раскроем, как ИИ помогает людям каждый день." }
            },
            {
              id: "a_e_02",
              layout: { x: 68, y: 8, w: 26, h: 62 },
              zIndex: 1,
              block: { id: "a_intro_guard", type: "media", kind: "image", url: "/api/coach/idle.png", caption: "Хранитель историй ИИ" }
            },
            {
              id: "a_e_03",
              layout: { x: 6, y: 34, w: 56, h: 34 },
              zIndex: 1,
              block: { id: "a_intro_mission", type: "text", body: "## Миссия на урок\n- Найти 3 ключа: **данные**, **обучение**, **проверка**\n- Разобраться, почему ИИ ошибается\n- Собрать свою первую мини-модель в Nodly" }
            }
          ]
        },
        {
          id: "a_s_02",
          title: "Проверка входа",
          elements: [
            {
              id: "a_e_04",
              layout: { x: 8, y: 20, w: 84, h: 52 },
              zIndex: 1,
              block: {
                id: "a_hook_q",
                type: "checkpoint",
                question: "Что из этого точнее описывает ИИ?",
                answerMode: "single",
                options: ["Магия без правил", "Программа, которая учится на данных", "База случайных ответов"],
                expectedAnswer: "Программа, которая учится на данных"
              }
            }
          ]
        },
        {
          id: "a_s_03",
          title: "ИИ вокруг нас",
          elements: [
            {
              id: "a_e_05",
              layout: { x: 6, y: 10, w: 88, h: 32 },
              zIndex: 1,
              block: { id: "a_everyday_ai", type: "text", body: "## Улика 1: ИИ уже рядом\n- Рекомендации в YouTube, TikTok, Netflix\n- Голосовые помощники\n- Фильтры и распознавание лица\n- Игровые NPC и подбор сложности" }
            },
            {
              id: "a_e_06",
              layout: { x: 6, y: 45, w: 88, h: 24 },
              zIndex: 1,
              block: { id: "a_fact_stream", type: "text", body: "### Факты\n- На YouTube загружают сотни часов видео каждую минуту\n- Человек не сможет это разобрать вручную\n- ИИ ищет похожие паттерны в поведении зрителей" }
            }
          ]
        },
        {
          id: "a_s_04",
          title: "Внутри ИИ",
          elements: [
            {
              id: "a_e_07",
              layout: { x: 6, y: 12, w: 88, h: 28 },
              zIndex: 1,
              block: { id: "a_voice_face_game", type: "text", body: "## Как это работает внутри\n1. Система получает данные (звук/фото/клики)\n2. Находит закономерности\n3. Делает предположение\n4. Улучшается на новых примерах" }
            },
            {
              id: "a_e_08",
              layout: { x: 6, y: 43, w: 88, h: 26 },
              zIndex: 1,
              block: { id: "a_ai_definition", type: "text", body: "## Что такое ИИ\n**ИИ — это не человек и не магия.**\nЭто алгоритм, который:\n- учится на примерах;\n- замечает повторяющиеся связи;\n- выдает предсказание с вероятностью." }
            }
          ]
        },
        {
          id: "a_s_05",
          title: "Данные",
          elements: [
            {
              id: "a_e_09",
              layout: { x: 6, y: 10, w: 88, h: 28 },
              zIndex: 1,
              block: { id: "a_data_food", type: "text", body: "## Улика 2: данные — топливо ИИ\nБез данных модель не учится, как ученик без задачника.\n\nНужны:\n- разнообразие примеров;\n- корректные подписи (разметка);\n- достаточный объем." }
            },
            {
              id: "a_e_10",
              layout: { x: 6, y: 41, w: 88, h: 30 },
              zIndex: 1,
              block: { id: "a_data_types", type: "text", body: "### Какие бывают данные\n- **Изображения**: лица, объекты, медицина\n- **Текст**: перевод, чат-боты\n- **Звук**: помощники, субтитры\n- **Таблицы**: прогнозы и аналитика" }
            }
          ]
        },
        {
          id: "a_s_06",
          title: "Разделение датасета",
          elements: [
            {
              id: "a_e_11",
              layout: { x: 8, y: 18, w: 84, h: 48 },
              zIndex: 1,
              block: { id: "a_split_text", type: "text", body: "## Улика 3: деление датасета\n- **80% обучающая выборка**: модель учится\n- **20% тестовая выборка**: честная проверка\n\nЕсли тест показать заранее, модель просто запомнит ответы." }
            }
          ]
        },
        {
          id: "a_s_07",
          title: "Цикл обучения",
          elements: [
            {
              id: "a_e_12",
              layout: { x: 8, y: 14, w: 84, h: 52 },
              zIndex: 1,
              block: { id: "a_train_pipeline", type: "text", body: "## Как учится модель\n1. Собрали и разметили данные\n2. Обучили модель\n3. Проверили на новых примерах\n4. Улучшили набор данных\n5. Повторили цикл" }
            }
          ]
        },
        {
          id: "a_s_08",
          title: "Ошибки модели",
          elements: [
            {
              id: "a_e_13",
              layout: { x: 6, y: 12, w: 88, h: 24 },
              zIndex: 1,
              block: { id: "a_loss_text", type: "text", body: "## Что такое Loss\n**Loss** показывает, насколько модель ошиблась.\n\n- Больше Loss -> хуже\n- Меньше Loss -> лучше\n\nВо время обучения цель — уменьшать Loss шаг за шагом." }
            },
            {
              id: "a_e_14",
              layout: { x: 6, y: 39, w: 88, h: 30 },
              zIndex: 1,
              block: { id: "a_under_overfit", type: "text", body: "## Недообучение и переобучение\n- **Недообучение**: модель слишком простая, не уловила паттерны\n- **Переобучение**: модель заучила тренировку и слаба на новых данных\n\nНужен баланс: не слишком просто и не слишком сложно." }
            }
          ]
        },
        {
          id: "a_s_09",
          title: "Квиз 1",
          elements: [
            {
              id: "a_e_15",
              layout: { x: 8, y: 22, w: 84, h: 44 },
              zIndex: 1,
              block: {
                id: "a_quiz_split",
                type: "checkpoint",
                question: "Зачем нужна тестовая выборка?",
                answerMode: "single",
                options: ["Чтобы увеличить скорость интернета", "Чтобы честно проверить модель на новых данных", "Чтобы украсить проект"],
                expectedAnswer: "Чтобы честно проверить модель на новых данных"
              }
            }
          ]
        },
        {
          id: "a_s_10",
          title: "Квиз 2 и 3",
          elements: [
            {
              id: "a_e_16",
              layout: { x: 6, y: 10, w: 88, h: 28 },
              zIndex: 1,
              block: {
                id: "a_quiz_overfit",
                type: "checkpoint",
                question: "Что значит переобучение?",
                answerMode: "single",
                options: ["Модель не видела обучающие данные", "Модель идеально запомнила тренировочные примеры, но плохо обобщает", "Модель не умеет предсказывать вообще"],
                expectedAnswer: "Модель идеально запомнила тренировочные примеры, но плохо обобщает"
              }
            },
            {
              id: "a_e_17",
              layout: { x: 6, y: 41, w: 88, h: 28 },
              zIndex: 1,
              block: {
                id: "a_quiz_loss",
                type: "checkpoint",
                question: "Что показывает метрика Loss?",
                answerMode: "single",
                options: ["Количество картинок в датасете", "Размер модели в мегабайтах", "Насколько модель ошибается"],
                expectedAnswer: "Насколько модель ошибается"
              }
            }
          ]
        },
        {
          id: "a_s_11",
          title: "Практика Nodly",
          elements: [
            {
              id: "a_e_18",
              layout: { x: 6, y: 8, w: 88, h: 12 },
              zIndex: 1,
              block: { id: "a_minidev_intro", type: "text", body: "## Мини-разработка: Первый запуск ИИ в Nodly\nСобери цепочку из блоков и запусти мини-эксперимент.\n\nЦель: пройти путь **данные -> обучение -> предсказание**." }
            },
            {
              id: "a_e_19",
              layout: { x: 6, y: 22, w: 88, h: 66 },
              zIndex: 1,
              block: {
                id: "a_minidev_studio",
                type: "studio",
                instruction: "Собери базовый pipeline: Старт -> Обучить модель -> Предсказать. Выбери датасет, запусти обучение и сделай хотя бы одно предсказание.",
                ctaAction: null,
                studioPracticeKind: "empty",
                studioWorkspaceLevel: 1,
                goals: [
                  { id: "a_goal_dataset", title: "Выбери image-датасет", type: "select_dataset", datasetKind: "image" },
                  { id: "a_goal_train_block", title: "Добавь блок «Обучить модель»", type: "add_block", blockType: "noda_train_model_simple" },
                  { id: "a_goal_train", title: "Запусти обучение модели", type: "train_model" },
                  { id: "a_goal_predict", title: "Сделай предсказание", type: "run_prediction" }
                ]
              }
            }
          ]
        },
        {
          id: "a_s_12",
          title: "Рефлексия",
          elements: [
            {
              id: "a_e_20",
              layout: { x: 8, y: 20, w: 84, h: 44 },
              zIndex: 1,
              block: {
                id: "a_reflect_q",
                type: "checkpoint",
                question: "Коротко: почему качество данных влияет на качество предсказания?",
                answerMode: "text",
                expectedAnswer: "Модель учится на данных: плохие или несбалансированные данные дают плохие предсказания."
              }
            }
          ]
        },
        {
          id: "a_s_13",
          title: "Финал",
          elements: [
            {
              id: "a_e_21",
              layout: { x: 6, y: 12, w: 56, h: 38 },
              zIndex: 1,
              block: { id: "a_finish_text", type: "text", textScale: "lg", body: "## Миссия выполнена\nТы уже умеешь:\n- объяснить, как ИИ учится;\n- отличать обучающую и тестовую выборки;\n- запускать мини-модель в Nodly.\n\nДальше — еще больше практики в модуле A." }
            },
            {
              id: "a_e_22",
              layout: { x: 66, y: 14, w: 28, h: 54 },
              zIndex: 1,
              block: { id: "a_finish_media", type: "media", kind: "image", url: "/api/coach/success.png", caption: "Хранитель: отличная работа, агент ИИ!" }
            }
          ]
        }
      ]
    },
    presentationPdfUrl: null,
    slides: [],
    practiceSteps: [],
    checkpoints: [],
    hints: []
  },
  lt_data_label: {
    slides: [
      {
        title: "Данные и разметка",
        body: "Качество модели напрямую зависит от качества разметки."
      }
    ],
    practiceSteps: [
      {
        title: "Проверь баланс классов",
        instruction: "Старайся, чтобы в каждом классе было похожее число примеров."
      }
    ],
    checkpoints: [
      {
        question: "Почему разметка важна?",
        expectedAnswer: "Модель учится на метках и без корректной разметки не поймет классы."
      }
    ],
    hints: [
      {
        title: "Смешанные классы",
        text: "Убери из класса примеры, которые похожи на другой класс."
      }
    ]
  },
  lt_first_model: {
    slides: [
      {
        title: "Первая модель",
        body: "Обучи модель, проверь точность и зафиксируй ошибки."
      }
    ],
    practiceSteps: [
      {
        title: "Обучи модель",
        instruction: "Сделай 10 эпох и посмотри метрики качества."
      },
      {
        title: "Проверь предсказания",
        instruction: "Протестируй модель на новых данных и запиши результат."
      }
    ],
    checkpoints: [
      {
        question: "Что делать, если модель часто ошибается?",
        expectedAnswer: "Добавить качественные данные и выровнять классы."
      }
    ],
    hints: [
      {
        title: "Освещение и ракурс",
        text: "Добавляй примеры при разном свете и угле съемки."
      }
    ]
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
        lessonContent: LESSON_CONTENT_SEED[s.id] ?? Prisma.JsonNull,
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

/** Подтягивает обновлённый content для старых seed-уроков, если там ещё нет deck-версии. */
export async function ensureLessonTemplateSeedContent() {
  const ids = Object.keys(LESSON_CONTENT_SEED);
  const rows = await prisma.lessonTemplate.findMany({
    where: { id: { in: ids } },
    select: { id: true, lessonContent: true }
  });
  for (const row of rows) {
    const current = row.lessonContent;
    const hasDeck =
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      (() => {
        const deck = (current as { deck?: { slides?: unknown[] } }).deck;
        return Boolean(deck && Array.isArray(deck.slides) && deck.slides.length > 0);
      })();
    if (hasDeck) {
      continue;
    }
    const seeded = LESSON_CONTENT_SEED[row.id];
    if (!seeded) {
      continue;
    }
    await prisma.lessonTemplate.update({
      where: { id: row.id },
      data: { lessonContent: seeded as Prisma.InputJsonValue }
    });
  }
}

const MODULE_A_QUEST_TEMPLATE_ID = "lt_module_a_keeper_quest";

/** Отдельный новый урок-квест в модуле A (создается/обновляется независимо от старых seed-уроков). */
export async function ensureModuleAQuestTemplate() {
  const guide = LESSON_GUIDE_SEED.lt_intro_ai;
  const questContent: Prisma.InputJsonValue = {
    schemaVersion: 2,
    blocks: [
      {
        id: "q00_briefing_title",
        type: "text",
        textScale: "lg",
        body: `# Дело о «синей печати»

Ты в **Агентстве историй Нодус** — службе, которая **собирает и проверяет факты**, чтобы рассказать, **как спасли** договор, репутацию или цепочку улик. Не «лаборатория ради лаборатории»: сначала история, потом цифры.

**Нодус** ведёт тебя как стажёра. Сегодняшняя история — про то, как **вернули подписи** к живым цветам, когда их **сломал чужой рукой**.

**Что спасаем.** По регламенту **синяя печать Архива** — краска для **заверения перемирия** — делается **только из линии Iris setosa**: другие виды дают похожий цвет, но печать **не ляжет** на договор — церемония сорвётся.

**Что сломалось.** В выгрузке из оранжереи **перемешали столбец вида**: часть строк без подписи, часть с чужой меткой. За этим стоит **Элиас Ворт** — «холодный следчик» конкурирующего бюро: он уже мелькал в других делах и снова бьёт по **цепочке доверия**. Руками тысячи строк не разобрать — нужна **модель в Nodly**, которая по четырём числам **находит настоящую setosa** и отсекает подделку.

Дальше — коротко про ИИ, данные и Iris; потом две мини-разработки: **обучить и сохранить**, затем **проверить лабораторию условием**.`
      },
      {
        id: "q00_hero",
        type: "media",
        kind: "image",
        url: "/api/coach/nodus-agency-hall.png",
        caption: "Зал Агентства — и Нодус ведёт дело о печати и проверке улик."
      },
      {
        id: "q00_greenhouse",
        type: "media",
        kind: "image",
        url: "/api/coach/iris-quest-greenhouse.png",
        caption: "Оранжерея: сырьё для печати; Нодус напоминает — в файле после саботажа подписи ненадёжны."
      },
      {
        id: "q00_story_lab",
        type: "text",
        body: `### Зал и оранжерея

В зале — регламенты и печати. В оранжереи — **сырьё для синей печати**: без точного **setosa** договор не закроется. **Элиас Ворт** оставил след в данных — разберёмся с помощью модели.`
      },
      {
        id: "q00_problem",
        type: "text",
        body: `## Экстренный вызов

Нужна **классификация** по четырём измерениям листа и лепестка: сначала обучение на чистом **Iris.csv**, потом проверка на **лабораторном файле** и отлов строк, где под видом setosa прячется ошибка. В **Nodly** ты восстановишь цепочку, по которой Агентство сможет **рассказать спасение печати**.`
      },
      { id: "q_div_00", type: "divider" },

      {
        id: "q01_gate_text",
        type: "text",
        body: `## Первая улика

В деле только **таблица**: четыре числа на цветок. Фотографий нет — как в учебной задаче. Вопрос: **можно ли по числам отличить вид** — и тем самым отделить **настоящую setosa** от подмены, которую подсунул **Элиас Ворт**?`
      },
      {
        id: "q00_hypothesis",
        type: "checkpoint",
        question: "Быстрая гипотеза стажера: можно ли отличить вид цветка только по числам измерений?",
        answerMode: "single",
        options: ["Да, если числа отражают важные признаки", "Нет, только по фотографии", "Нет, модель всегда угадывает случайно"],
        expectedAnswer: "Да, если числа отражают важные признаки"
      },

      {
        id: "q01_ai_around_title",
        type: "text",
        body: `## ИИ уже рядом

**ИИ уже в сервисах**, которыми ты пользуешься: не «сознание в коробке», а программы, которые учатся на примерах и ищут закономерности в данных.

В нашем деле это **классификация вида цветка** по числам. Если ИИ держит шумные данные в других задачах — с ирисами тоже можно, при нормальной разметке и проверке.`
      },
      {
        id: "q01_ai_examples",
        type: "text",
        body: `### Стена улик

- **Стриминги** — что смотришь и пропускаешь.
- **Фильтры лица** — точки и маска.
- **Голос** — звук в слова и намерение.
- **Игры** — поведение NPC и сложность.
- **Перевод** — смысл между языками.

Лицо и голос узнаёт — значит, и вид ириса по признакам не чудо.`
      },
      {
        id: "q01_ai_or_not",
        type: "checkpoint",
        question: "Что из этого ближе всего к ИИ?",
        answerMode: "multi",
        options: ["Рекомендации видео", "Распознавание лица", "Голосовой помощник", "Обычный таймер на телефоне"],
        expectedAnswer: "Рекомендации видео||Распознавание лица||Голосовой помощник"
      },
      { id: "q_div_01", type: "divider" },

      {
        id: "q02_what_is_ai",
        type: "text",
        body: `## Что такое ИИ

**ИИ** — программа, которая учится на примерах, ищет закономерности в данных, делает предсказание и калибруется на проверке.

Не «думает как человек» — находит **математические связи**.`
      },
      {
        id: "q02_models_tasks",
        type: "text",
        body: `### Задачи ИИ (сжато)

| Задача | Суть | Пример |
|---|---|---|
| Классификация | класс | ирис, спам |
| Регрессия | число | цена, температура |
| Распознавание | объект / речь | лицо, голос |
| Генерация | новое | текст, картинка |
| Рекомендации | вариант | видео, товары |

В этом деле — **классификация** (три вида).`
      },
      {
        id: "q02_model_types",
        type: "text",
        body: `### Модели одной строкой

**Правила** — если то, то действие. **Дерево** — цепочка вопросов. **kNN** — соседи похожих примеров. **Нейросеть** — много параметров, учатся на ошибках.

Важно помнить цикл: **данные → обучение → проверка → предсказание**.`
      },
      {
        id: "q02_check",
        type: "checkpoint",
        question: "Какую задачу мы решаем в этом деле?",
        answerMode: "single",
        options: ["Классификация", "Генерация музыки", "Перевод текста"],
        expectedAnswer: "Классификация"
      },
      { id: "q_div_02", type: "divider" },

      {
        id: "q03_data_title",
        type: "text",
        body: `## Данные

Без данных модель не учится. С данными плохого качества — учится плохо.

Форматы: изображения, звук, текст, таблицы чисел.`
      },
      {
        id: "q03_data_drawer",
        type: "text",
        body: `### Данные в Nodly — заглянем вперёд

Чуть позже ты откроешь **Nodly** и соберёшь цепочку из блоков. Таблицу для учёбы и примеры для проверки нужно задать отдельно: для этого в Nodly есть раздел **«Данные»** (это не кубик в цепочке, а отдельное окно). Там по сути три вещи: **чем учить модель**, **какие строки подставить на вход** для шага «Предсказать» и **сохранённые модели**. Отдельного блока «выбрать таблицу» в палитре нет — сначала настраивают «Данные», потом схему.

Пока без разбора кнопок: ниже — что такое **датасет** и **вход**, это пригодится и в Архиве, и в Nodly.`
      },
      {
        id: "q03_datasets_io",
        type: "text",
        body: `### Датасет и входы

**Датасет** — таблица примеров (например Iris): в каждой строке **четыре числа** — измерения чашелистика и лепестка (длина/ширина), это **признаки**; последний столбец — **метка** (вид цветка). Такие строки — как **записи параметров цветков** в журнале лаборатории.

**Учебный датасет** — много размеченных примеров, на которых модель **учится**. **Лабораторный файл** — новые измерения из оранжереи: по ним проверяют модель и ищут нужный вид.

**Вход при предсказании** — либо одна новая строка чисел, либо целый файл таких строк (без переобучения на нём).`
      },
      {
        id: "q03_datasets_check",
        type: "checkpoint",
        question: "Что вернее про входные данные при предсказании уже после обучения?",
        answerMode: "single",
        options: [
          "Это новые признаки одного примера, а не весь датасет для переобучения",
          "Это случайная половина строк из train",
          "Это то же самое, что колонка с меткой в таблице"
        ],
        expectedAnswer: "Это новые признаки одного примера, а не весь датасет для переобучения"
      },
      {
        id: "q03_labels",
        type: "text",
        body: `### Разметка

Подписи к примерам: фото «кошка/собака», письмо «спам», цветок — **setosa / versicolor / virginica**.

Битая разметка — плохие уроки для модели.`
      },
      {
        id: "q03_data_check",
        type: "checkpoint",
        question: "Что будет, если часть данных размечена неправильно?",
        answerMode: "single",
        options: ["Модель может научиться ошибочным закономерностям", "Модель станет идеальной", "Разметка ни на что не влияет"],
        expectedAnswer: "Модель может научиться ошибочным закономерностям"
      },
      { id: "q_div_03", type: "divider" },

      {
        id: "q04_iris_case",
        type: "text",
        textScale: "lg",
        body: `## Досье Iris

Три вида: **setosa**, **versicolor**, **virginica**. Для **синей печати** критична именно **setosa** — остальные дают «почти верный» оттенок, но регламент не проходит. После вмешательства **Элиаса Ворта** в выгрузке часть меток **лжёт** или пустая — ориентируйся на числа и на модель.`
      },
      {
        id: "q04_dossier_image",
        type: "media",
        kind: "image",
        url: "/api/coach/iris-quest-dossier.png",
        caption: "Панель досье в Архиве — Нодус поясняет три вида и признаки к делу о setosa."
      },
      {
        id: "q04_table",
        type: "text",
        body: `### Таблица улик

| Длина лепестка | Ширина лепестка | Длина чашелистика | Ширина чашелистика | Вид |
|---:|---:|---:|---:|---|
| 1.4 | 0.2 | 5.1 | 3.5 | Setosa |
| 4.7 | 1.4 | 7.0 | 3.2 | Versicolor |
| 6.0 | 2.5 | 6.3 | 3.3 | Virginica |

Строка = пример; числа = **признаки**; вид = **метка**; задача = классификация.`
      },
      {
        id: "q04_features_check",
        type: "checkpoint",
        question: "В Iris dataset что является признаками, а что меткой?",
        answerMode: "single",
        options: ["Признаки — измерения, метка — вид цветка", "Признак — вид цветка, метка — длина", "Все столбцы являются метками"],
        expectedAnswer: "Признаки — измерения, метка — вид цветка"
      },
      {
        id: "q04_hypothesis_check",
        type: "checkpoint",
        question: "Первая гипотеза детектива: если лепесток очень короткий, какой вид чаще всего ожидаем?",
        answerMode: "single",
        options: ["Setosa", "Versicolor", "Virginica"],
        expectedAnswer: "Setosa"
      },
      { id: "q_div_04", type: "divider" },

      {
        id: "q05_training_title",
        type: "text",
        body: `## Как учится модель

По шагам, с нуля:

1. Есть **таблица примеров** — у каждой строки признаки и правильный **класс** (вид ириса).
2. Часть строк отдаём на **обучение**: модель много раз прогоняет их и **подкручивает** внутренние настройки, чтобы ошибаться меньше.
3. Другую часть оставляем для **проверки** — по ней смотрим, не «зубрила» ли модель только учебные строки.
4. Потом можно подать **новую** строку чисел и спросить **предсказание** — какой вид модель выберет.

Ниже — картинка, как делят таблицу на train и test.`
      },
      {
        id: "q05_split_image",
        type: "media",
        kind: "image",
        url: "/api/coach/iris-quest-dataset-split.png",
        caption: "Часть примеров уходит в обучение, часть — в проверку. Так честнее оценить модель."
      },
      {
        id: "q05_split_text",
        type: "text",
        body: `### Train и test

**Train** (обучение) — примеры, на которых модель **учится**. **Test** (контроль) — примеры «для экзамена»: их не показывают во время учёбы, чтобы честно проверить, выучилась закономерность или нет.

Часто берут, например, **80%** строк в train и **20%** в test. Если подмешать test в train, оценка получится **слишком оптимистичной**: модель может просто **запомнить ответы**, а не научиться правилу.`
      },
      {
        id: "q05_split_check",
        type: "checkpoint",
        question: "Почему нельзя обучаться на тестовой выборке?",
        answerMode: "single",
        options: ["Проверка станет нечестной", "Модель перестанет запускаться", "CSV станет слишком большим"],
        expectedAnswer: "Проверка станет нечестной"
      },
      { id: "q_div_05", type: "divider" },

      {
        id: "q06_metrics_title",
        type: "text",
        body: `## Метрики

Модель может **уверенно** ошибаться. Цифры **метрик** помогают понять, насколько она реально хороша, а не только «как звучит ответ».`
      },
      {
        id: "q06_metrics_text",
        type: "text",
        body: `### Что смотреть

**Точность (accuracy)** — какая доля ответов **верная** на выбранной выборке. Для классификации это удобная первая цифра: «угадала ли модель класс».

**Уверенность (confidence)** — насколько модель **сама довольна** своим ответом. Высокая уверенность **не значит** правду: её всегда сверяют с accuracy на test.

**Loss (ошибка)** — насколько далеко предсказание от правильного ответа **во время обучения**. Обычно хотят, чтобы loss **снижался** от эпохи к эпохе; если он почти не падает — модель плохо учится или данные мешают.

Итого: смотри **точность на test** и **как ведёт себя loss**, а не один красивый процент уверенности.`
      },
      {
        id: "q06_trust_check",
        type: "checkpoint",
        question: "Кому больше доверять?",
        answerMode: "single",
        options: ["Модели с test accuracy 95%", "Модели с confidence 99%, но test accuracy 60%", "Модели без проверки"],
        expectedAnswer: "Модели с test accuracy 95%"
      },
      {
        id: "q06_loss_check",
        type: "checkpoint",
        question: "Что показывает Loss?",
        answerMode: "single",
        options: ["Насколько модель ошибается", "Сколько цветов в датасете", "Название класса"],
        expectedAnswer: "Насколько модель ошибается"
      },
      { id: "q_div_06", type: "divider" },

      {
        id: "q07_fit_title",
        type: "text",
        body: `## Ловушки обучения

**Недообучение** — модель **не доросла**: на train ответы всё ещё плохие, на новых данных тоже. Часто значит: мало эпох, слишком простая модель или данные сложные.

**Переобучение** — модель **зазубрила** train: там почти всё верно, а на test или на новых цветках — заметно хуже. Как учить билеты наизусть к одному билету, а на другом провалиться.

**Нормальный вариант** — train и test оба **неплохие**, разрыв между ними **не огромный**.`
      },
      {
        id: "q07_fit_image",
        type: "media",
        kind: "image",
        url: "/api/coach/iris-quest-overfit.png",
        caption: "Схема: недообучение, нормальный баланс и переобучение — по тому, как ведут себя ошибка на train и на новых данных."
      },
      {
        id: "q07_fit_text",
        type: "text",
        body: `### Как отличить по цифрам

- Train **низко**, test **низко** → скорее **недообучение**.
- Train **высоко**, test **заметно ниже** → скорее **переобучение**.
- Оба **средние или хорошие** и близко друг к другу → чаще **нормальный** режим.

Схема на картинке ниже — то же самое наглядно.`
      },
      {
        id: "q07_fit_check",
        type: "checkpoint",
        question: "Train accuracy = 99%, test accuracy = 60%. Что вероятнее всего?",
        answerMode: "single",
        options: ["Переобучение", "Недообучение", "Идеальная модель"],
        expectedAnswer: "Переобучение"
      },
      { id: "q_div_07", type: "divider" },

      {
        id: "q08_noda_title",
        type: "text",
        body: `## Nodly

Инструменты стажера — **блоки**: логику собирают цепочкой, без кода с нуля.`
      },
      {
        id: "q08_blocks_image",
        type: "media",
        kind: "image",
        url: "/api/coach/iris-quest-noda-blocks.png",
        caption: "Палитра блоков Nodly: события, данные, обучение, предсказание и вывод."
      },
      {
        id: "q08_blocks_text",
        type: "text",
        body: `### Блоки уровня 1 (как в палитре Nodly)

Датасет для обучения и строки для предсказания задаются в Nodly в разделе **«Данные»**, не отдельным блоком в цепочке.

- **Старт** — шляпа цепочки: запуск по кнопке «Старт».
- **Обучить модель** — обучение на датасете из «Данные → Обучение».
- **Сохранить модель в библиотеку** — после обучения (в квесте доступен уже на уровне 1).
- **Предсказать** — прогон по уже обученной модели; источник: **ввести числа в блоке**, строка из **«Данные → Входы»**, либо **файл из «Данные → Обучение»** (одна строка по номеру или **весь файл** — таблица ответов во «Визуализации»).
- **если … то**, **если … то (без иначе)** — ветвление по условию.
- **ждать … сек** — пауза.
- **\[ \] > \[ \]**, **\[ \] и \[ \]**, **\[ \] или \[ \]**, **не \[ \]** — логические кирпичики для условий.
- **уверенность**, **предсказанный класс** — значения после «Предсказать».
- **число**, **текст** — константы в цепочку.
- **показать результат**, **показать сообщение**, **добавить в журнал** — вывод для ученика.

Типичная цепочка: **Старт → Обучить модель → Предсказать → (если нужно) если … то → показать сообщение / результат**.`
      },
      {
        id: "q08_blocks_check",
        type: "checkpoint",
        question: "Какой блок отвечает за обучение модели?",
        answerMode: "single",
        options: ["Обучить модель", "Показать сообщение", "Ждать сек"],
        expectedAnswer: "Обучить модель"
      },
      { id: "q_div_08", type: "divider" },

      {
        id: "q08_models_intro",
        type: "text",
        textScale: "lg",
        body: `## Типы моделей для таблицы

В **Nodly** в блоке **«Обучить модель»** выбирают **тип** — что именно модель должна выдавать по строке таблицы.

- **Таблица: классификация** — ответ **класс** (например **вид ириса**). Это как раз наше дело.
- **Таблица: регрессия** — ответ **одно число** (цена, температура и т.п.), не «категория».
- **Таблица: нейросеть (MLP)** — тоже таблица, но внутри другая математика: часто нужно больше примеров и времени на обучение.

Картинки и другие режимы — в других уроках и уровнях. Здесь важно: для ирисов берём **классификацию**.`
      },
      {
        id: "q08_models_check",
        type: "checkpoint",
        question: "Для вида ириса по столбцам таблицы какой тип в блоке «Обучить модель» подходит?",
        answerMode: "single",
        options: ["Таблица: классификация", "Таблица: регрессия", "Таблица: нейросеть (MLP)"],
        expectedAnswer: "Таблица: классификация"
      },
      { id: "q_div_08c", type: "divider" },

      {
        id: "q09_two_datasets",
        type: "text",
        body: `### Два файла в «Данные → Обучение»

**Iris (Iris.csv)** — учимся. **Оранжерея лаборатории** — проверяем предсказаниями (одна строка или **весь файл**; список — на вкладке «Визуализация» и на сцене мини-студии).`
      },
      {
        id: "q09_lab_title",
        type: "text",
        textScale: "lg",
        body: `## Две мини-разработки

**Первая вкладка** — обучить классификатор на Iris и **сохранить модель** в библиотеку. **Вторая вкладка** — новый черновик среды: снова коротко **обучи на Iris**, затем **Предсказать** по лабораторному файлу (лучше **весь файл**), **если … то** и сообщение/результат для **Iris-setosa** (сырьё для **синей печати** после саботажа меток).

На сцене мини-студии — короткие подсказки и график обучения; длинный текст — только в ленте урока слева.`
      },
      {
        id: "q09_lab_image",
        type: "media",
        kind: "image",
        url: "/api/coach/iris-quest-greenhouse.png",
        caption: "Лабораторная оранжерея; Нодус — дальше две вкладки мини-студии по очереди."
      },
      { id: "q_div_practice_1", type: "divider" },
      {
        id: "q09_page1_title",
        type: "text",
        body: `## Обучение и сохранение

Собери цепочку: **Старт → Обучить модель** (Iris, классификация) → **Сохранить модель в библиотеку**. Запусти **Старт** и дождись конца обучения, затем снова **Старт**, чтобы выполнилось сохранение. На сцене мини-студии смотри кривую **loss** во время обучения.`
      },
      {
        id: "q09a_studio",
        type: "studio",
        instruction:
          "**Старт** → обучение на **Iris (Iris.csv)**, классификация → **Сохранить модель**. Пока идёт обучение — на сцене график; в конце — точность.",
        studioPracticeKind: "empty",
        studioWorkspaceLevel: 1,
        goals: [
          { id: "q9a_goal_dataset", title: "Данные: есть табличный датасет", type: "select_dataset", datasetKind: "tabular" },
          { id: "q9a_goal_train_block", title: "Добавь «Обучить модель»", type: "add_block", blockType: "noda_train_model_simple" },
          { id: "q9a_goal_save_block", title: "Добавь «Сохранить модель в библиотеку»", type: "add_block", blockType: "noda_save_model" },
          { id: "q9a_goal_train", title: "Запусти обучение (Старт)", type: "train_model" },
          { id: "q9a_goal_save", title: "Выполни сохранение модели (Старт после обучения)", type: "save_model" }
        ]
      },
      { id: "q_div_practice_2", type: "divider" },
      {
        id: "q09_page2_title",
        type: "text",
        body: `## Лаборатория и условие

Открылась **вторая** мини-студия (новый облачный черновик): модель из шага 1 здесь не переносится — как после переустановки. **Снова** обучи на **Iris**, затем **Предсказать** по **Оранжерея лаборатории** (**весь файл**), добавь **если … то (без иначе)** и **показать сообщение** или **показать результат** для **Iris-setosa** — именно эти строки нужны для **синей печати**, пока метки в файле после Ворта ненадёжны. Список ответов — внизу сцены после графика.`
      },
      {
        id: "q09b_studio",
        type: "studio",
        instruction:
          "**Старт** → **Обучить модель** (Iris) → **Предсказать** (лаборатория, **весь файл**) → **если** предсказанный класс = **Iris-setosa** → **показать сообщение** / **результат** (сырьё для печати). Смотри график при обучении.",
        studioPracticeKind: "empty",
        studioWorkspaceLevel: 1,
        goals: [
          { id: "q9b_goal_dataset", title: "Данные: таблица на месте", type: "select_dataset", datasetKind: "tabular" },
          { id: "q9b_goal_train_block", title: "Блок «Обучить модель»", type: "add_block", blockType: "noda_train_model_simple" },
          { id: "q9b_goal_predict_block", title: "Блок «Предсказать»", type: "add_block", blockType: "noda_predict_l1" },
          { id: "q9b_goal_if", title: "Блок «если … то (без иначе)»", type: "add_block", blockType: "noda_if_then_only" },
          { id: "q9b_goal_train", title: "Запусти обучение", type: "train_model" },
          { id: "q9b_goal_predict", title: "Сделай предсказание по лаборатории", type: "run_prediction" }
        ]
      },
      {
        id: "q09_post_practice",
        type: "text",
        body: `### Кратко

Учебный и лабораторный файлы не смешивать. В «боевом» проекте шаг 1 оставил бы модель в библиотеке для шага 2 без переобучения — в квесте второй черновик это имитирует отдельную сессию.`
      },
      { id: "q_div_09", type: "divider" },

      {
        id: "q10_final_title",
        type: "text",
        body: `## Дело закрыто

Агентство может **рассказать историю спасения**: по цепочке в Nodly мы отделили **настоящую Iris setosa** от шума после саботажа — **синяя печать** снова на конвейер.

- ИИ учится на данных, не «магия».
- Нужна разметка и **честная** проверка.
- Метрики и Nodly — чтобы доверять не словам, а цепочке.

**Дело 002** — уже про картинки, не таблицы.`
      },
      {
        id: "q10_final_image",
        type: "media",
        kind: "image",
        url: "/api/coach/iris-quest-finale.png",
        caption: "Стол в Архиве после работы — Нодус закрывает дело, печать снова под контролем."
      },
      {
        id: "q10_final_hook",
        type: "text",
        body: `### Следующая папка

**Дело 002: изображения** — модель учится по картинкам, не по столбцам таблицы. **Элиас Ворт** с этим делом не закончил: его следы всплывут и там — держи глаз на цепочке доказательств.`
      },
      {
        id: "q10_final_check",
        type: "checkpoint",
        question: "Перед тем как доверять модели, что нужно проверить?",
        answerMode: "multi",
        options: ["Качество на тестовой выборке", "Loss и ошибки", "Качество данных", "Только красивый интерфейс"],
        expectedAnswer: "Качество на тестовой выборке||Loss и ошибки||Качество данных"
      }
    ],
    presentationPdfUrl: null,
    slides: [],
    practiceSteps: [],
    checkpoints: [],
    hints: []
  };
  await prisma.lessonTemplate.upsert({
    where: { id: MODULE_A_QUEST_TEMPLATE_ID },
    create: {
      id: MODULE_A_QUEST_TEMPLATE_ID,
      title: "Дело о «синей печати»",
      description: "Агентство историй Нодус: саботаж меток, Iris setosa для печати и первая модель в Nodly.",
      moduleKey: "module_a",
      sortOrder: 0,
      starterPayload: EMPTY_SNAPSHOT,
      lessonContent: questContent,
      published: true,
      teacherGuideMd: guide.teacherGuideMd,
      studentSummary: "История спасения синей печати: setosa после саботажа Элиаса Ворта; Iris и лабораторный файл; две мини-студии в Nodly."
    },
    update: {
      title: "Дело о «синей печати»",
      description: "Агентство историй Нодус: саботаж меток, Iris setosa для печати и первая модель в Nodly.",
      moduleKey: "module_a",
      sortOrder: 0,
      lessonContent: questContent,
      published: true,
      teacherGuideMd: guide.teacherGuideMd,
      studentSummary: "История спасения синей печати: setosa после саботажа Элиаса Ворта; Iris и лабораторный файл; две мини-студии в Nodly."
    }
  });
}
