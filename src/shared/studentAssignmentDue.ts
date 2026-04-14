import dayjs from "dayjs";

export function submissionStatusUnfinished(status: string): boolean {
  return status !== "submitted" && status !== "graded";
}

/** Срок истёк (конец календарного дня сдачи раньше текущего момента), работа ещё не завершена. */
export function isOverdueByDueAt(dueAt: string | null, submissionStatus: string): boolean {
  if (!dueAt || !submissionStatusUnfinished(submissionStatus)) {
    return false;
  }
  return dayjs(dueAt).endOf("day").isBefore(dayjs());
}

/**
 * Срок ещё не просрочен, но попадает в ближайшие `days` календарных дней (включая сегодня).
 * Задания без срока не попадают.
 */
export function isDueWithinUpcomingDays(
  dueAt: string | null,
  submissionStatus: string,
  days: number
): boolean {
  if (!dueAt || !submissionStatusUnfinished(submissionStatus)) {
    return false;
  }
  if (isOverdueByDueAt(dueAt, submissionStatus)) {
    return false;
  }
  const horizonEnd = dayjs().add(days, "day").endOf("day");
  return !dayjs(dueAt).endOf("day").isAfter(horizonEnd);
}

/** Домашнее задание для блока «быстрые ДЗ» на главной: просроченное или срок в горизонте. */
export function showOnHomeQuickHomework(
  kind: string,
  dueAt: string | null,
  submissionStatus: string,
  horizonDays: number
): boolean {
  if (kind !== "homework") {
    return false;
  }
  if (!submissionStatusUnfinished(submissionStatus)) {
    return false;
  }
  if (isOverdueByDueAt(dueAt, submissionStatus)) {
    return true;
  }
  return isDueWithinUpcomingDays(dueAt, submissionStatus, horizonDays);
}
