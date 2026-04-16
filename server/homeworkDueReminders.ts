import { prisma } from "./db.js";
import { config } from "./config.js";
import { sendStudentHomeworkDueTomorrowEmail } from "./email.js";

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


/** Один проход: ДЗ со сроком «завтра» по локальному дню сервера, ученик ещё не сдал / не оценён, письмо не отправляли. */
export async function runHomeworkDueRemindersOnce(): Promise<void> {
  const tomorrowStart = addLocalDays(startOfLocalDay(), 1);
  const dayAfterTomorrow = addLocalDays(tomorrowStart, 1);
  const dueDateLabel = tomorrowStart.toLocaleDateString("ru-RU");
  const appUrl = `${config.appBaseUrl.replace(/\/$/, "")}/class`;

  const assignments = await prisma.assignment.findMany({
    where: {
      kind: "homework",
      published: true,
      dueAt: { gte: tomorrowStart, lt: dayAfterTomorrow }
    },
    select: {
      id: true,
      title: true,
      classroom: {
        select: {
          title: true,
          enrollments: {
            select: {
              studentId: true,
              student: { select: { email: true } }
            }
          }
        }
      }
    }
  });

  for (const a of assignments) {
    for (const en of a.classroom.enrollments) {
      const email = en.student.email?.trim();
      if (!email) {
        continue;
      }
      const sub = await prisma.submission.findUnique({
        where: { assignmentId_studentId: { assignmentId: a.id, studentId: en.studentId } },
        select: { status: true, homeworkDueReminderSentAt: true }
      });
      if (sub?.homeworkDueReminderSentAt) {
        continue;
      }
      if (sub?.status === "submitted" || sub?.status === "graded") {
        continue;
      }
      try {
        await sendStudentHomeworkDueTomorrowEmail(email, {
          assignmentTitle: a.title,
          classTitle: a.classroom.title,
          dueDateLabel,
          appUrl
        });
      } catch {
        continue;
      }
      await prisma.submission.upsert({
        where: { assignmentId_studentId: { assignmentId: a.id, studentId: en.studentId } },
        create: {
          assignmentId: a.id,
          studentId: en.studentId,
          status: "not_started",
          homeworkDueReminderSentAt: new Date()
        },
        update: { homeworkDueReminderSentAt: new Date() }
      });
    }
  }
}

function msUntilNextLocalMidnight(from: Date = new Date()): number {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return Math.max(10_000, next.getTime() - from.getTime());
}

/** Первый запуск в ближайшую полночь по локали сервера, затем раз в сутки. */
export function startHomeworkDueReminderScheduler(): void {
  const MS_DAY = 86_400_000;
  setTimeout(() => {
    void runHomeworkDueRemindersOnce().catch(() => {
      /* PoC */
    });
    setInterval(
      () => {
        void runHomeworkDueRemindersOnce().catch(() => {
          /* PoC */
        });
      },
      MS_DAY
    );
  }, msUntilNextLocalMidnight());
}
