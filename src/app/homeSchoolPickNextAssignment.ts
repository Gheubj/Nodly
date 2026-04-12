import type { HomeSchoolAssignmentRow } from "@/hooks/useHomeSchoolAssignments";
import {
  studentSlotNeedsAttention,
  type SlotStudentAssignmentRow
} from "@/app/WeekScheduleCalendar";

function toSlotRow(r: HomeSchoolAssignmentRow): SlotStudentAssignmentRow {
  return {
    assignmentId: r.assignmentId,
    classroomId: r.classroomId,
    classroomTitle: r.classroomTitle,
    schoolName: r.schoolName,
    title: r.title,
    kind: r.kind,
    dueAt: r.dueAt,
    maxScore: r.maxScore,
    submission: r.submission
  };
}

function overdue(r: HomeSchoolAssignmentRow): boolean {
  const st = r.submission?.status ?? "not_started";
  if (!r.dueAt || st === "submitted" || st === "graded") {
    return false;
  }
  const end = new Date(r.dueAt);
  end.setHours(23, 59, 59, 999);
  return end.getTime() < Date.now();
}

/** Чем больше — тем важнее для «Следующее действие». */
function priority(r: HomeSchoolAssignmentRow): number {
  const row = toSlotRow(r);
  const st = r.submission?.status ?? "not_started";
  if (studentSlotNeedsAttention(row)) {
    if (st === "needs_revision") {
      return 4;
    }
    if (st === "graded") {
      return 3;
    }
  }
  if (overdue(r)) {
    return 2;
  }
  if (st === "draft") {
    return 1;
  }
  if (st === "not_started" || !r.submission) {
    return 0;
  }
  return -1;
}

function dueTs(r: HomeSchoolAssignmentRow): number {
  return r.dueAt ? new Date(r.dueAt).getTime() : Number.POSITIVE_INFINITY;
}

export function pickNextSchoolAssignment(rows: HomeSchoolAssignmentRow[]): HomeSchoolAssignmentRow | null {
  const candidates = rows.filter((r) => {
    const st = r.submission?.status ?? "not_started";
    if (st === "submitted") {
      return false;
    }
    if (st === "graded" && !studentSlotNeedsAttention(toSlotRow(r))) {
      return false;
    }
    return priority(r) >= 0;
  });
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => {
    const pb = priority(b) - priority(a);
    if (pb !== 0) {
      return pb;
    }
    const da = dueTs(a) - dueTs(b);
    if (da !== 0) {
      return da;
    }
    const k = a.kind.localeCompare(b.kind, "ru");
    if (k !== 0) {
      return k;
    }
    return a.title.localeCompare(b.title, "ru");
  });
  return candidates[0] ?? null;
}
