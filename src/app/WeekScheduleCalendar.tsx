import { Button, Card, Popconfirm, Select, Space, Tag, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import "dayjs/locale/ru";
import { isOverdueByDueAt } from "@/shared/studentAssignmentDue";

dayjs.extend(isoWeek);
dayjs.locale("ru");

const { Text } = Typography;

/** Минимальные поля задания ученика для кнопок в календаре (совместимо с StudentAssignmentRow) */
export type SlotStudentAssignmentRow = {
  assignmentId: string;
  classroomId: string;
  classroomTitle: string;
  schoolName: string;
  title: string;
  kind: string;
  dueAt: string | null;
  maxScore: number;
  lessonTemplateId: string | null;
  submission: {
    id: string;
    status: string;
    score: number | null;
    projectId: string | null;
    gradedSeenAt: string | null;
    teacherNote: string | null;
    revisionNote: string | null;
  } | null;
};

export type SlotLinkedAssignment = {
  id: string;
  title: string;
  kind: string;
  dueAt: string | null;
  studentRow?: SlotStudentAssignmentRow;
};

export type WeekScheduleSlot = {
  id: string;
  startsAt: string;
  durationMinutes: number;
  /** Если с бэкенда пришло — показываем конец по нему, иначе считаем от длительности */
  endsAt?: string | null;
  lessonTemplateId?: string | null;
  lessonTitle: string | null;
  notes: string | null;
  weeklySeriesId?: string | null;
  myPlansToAttend?: boolean | null;
  linkedAssignments?: SlotLinkedAssignment[];
};

export const diaryKindLabels: Record<string, string> = {
  classwork: "Классная работа",
  homework: "ДЗ"
};

export const diaryStatusLabels: Record<string, string> = {
  not_started: "Не начато",
  draft: "Черновик",
  submitted: "Сдано",
  needs_revision: "Доработка",
  graded: "Оценено"
};

export function studentSlotNeedsAttention(row: SlotStudentAssignmentRow): boolean {
  const st = row.submission?.status ?? "not_started";
  if (st === "needs_revision") {
    return true;
  }
  if (st === "graded" && row.submission && !row.submission.gradedSeenAt) {
    return true;
  }
  return false;
}

type Props = {
  weekAnchor: Dayjs;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek?: () => void;
  slots: WeekScheduleSlot[];
  variant: "teacher" | "student";
  onDeleteSlot?: (slotId: string) => void;
  onDeleteSeries?: (seriesId: string) => void;
  /** Только кабинет учителя: правка времени, заметок и урока программы */
  onEditSlot?: (slotId: string) => void;
  onAttendanceChange?: (slotId: string, value: boolean | null) => void;
  onStudentStartAssignment?: (row: SlotStudentAssignmentRow) => void;
  onStudentSubmitAssignment?: (row: SlotStudentAssignmentRow) => void;
  onStudentMarkGradedSeen?: (row: SlotStudentAssignmentRow) => void;
};

function dayKey(d: Dayjs) {
  return d.format("YYYY-MM-DD");
}

function slotTimeRangeLabel(slot: Pick<WeekScheduleSlot, "startsAt" | "durationMinutes" | "endsAt">) {
  const start = dayjs(slot.startsAt);
  const end = slot.endsAt
    ? dayjs(slot.endsAt)
    : start.add(slot.durationMinutes, "minute");
  return `${start.format("HH:mm")}–${end.format("HH:mm")}`;
}

function slotStarted(iso: string) {
  return dayjs(iso).isBefore(dayjs());
}

/** Не дублировать тег типа: шаблонные названия с сервера скрываем или оставляем только уточнение после «: » */
export function diaryStudentAssignmentCaption(title: string, kind: string): string | null {
  const t = title.trim();
  if (!t) {
    return null;
  }
  if (kind === "classwork") {
    if (t === "Работа на уроке" || t === "Классная работа") {
      return null;
    }
    const prefixes = ["Классная работа: ", "На уроке: "];
    for (const prefix of prefixes) {
      if (t.startsWith(prefix)) {
        const rest = t.slice(prefix.length).trim();
        return rest || null;
      }
    }
    return t;
  }
  if (kind === "homework") {
    if (t === "Домашнее задание" || t === "ДЗ") {
      return null;
    }
    for (const prefix of ["ДЗ: ", "Домашнее: "]) {
      if (t.startsWith(prefix)) {
        const rest = t.slice(prefix.length).trim();
        return rest || null;
      }
    }
    return t;
  }
  return t;
}

export function WeekScheduleCalendar({
  weekAnchor,
  onPrevWeek,
  onNextWeek,
  onThisWeek,
  slots,
  variant,
  onDeleteSlot,
  onDeleteSeries,
  onEditSlot,
  onAttendanceChange,
  onStudentStartAssignment,
  onStudentSubmitAssignment,
  onStudentMarkGradedSeen
}: Props) {
  const monday = weekAnchor.startOf("isoWeek");
  const days = Array.from({ length: 7 }, (_, i) => monday.add(i, "day"));

  const byDay = new Map<string, WeekScheduleSlot[]>();
  for (const s of slots) {
    const k = dayKey(dayjs(s.startsAt));
    const arr = byDay.get(k) ?? [];
    arr.push(s);
    byDay.set(k, arr);
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => dayjs(a.startsAt).valueOf() - dayjs(b.startsAt).valueOf());
  }

  const rangeLabel = `${monday.format("D MMM")} — ${monday.add(6, "day").format("D MMM YYYY")}`;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap align="center" className="week-schedule-toolbar">
        <Button type="default" onClick={onPrevWeek}>
          ← Неделя
        </Button>
        <Text strong style={{ minWidth: 200, textAlign: "center" }}>
          {rangeLabel}
        </Text>
        <Button type="default" onClick={onNextWeek}>
          Неделя →
        </Button>
        {onThisWeek ? (
          <Button type="link" onClick={onThisWeek}>
            Текущая неделя
          </Button>
        ) : null}
      </Space>
      <div className="week-schedule-grid">
        {days.map((d) => {
          const key = dayKey(d);
          const daySlots = byDay.get(key) ?? [];
          const title = d.format("dd D MMM");
          return (
            <Card key={key} size="small" className="week-schedule-day" title={title}>
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                {daySlots.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Нет занятий
                  </Text>
                ) : (
                  daySlots.map((slot) => (
                    <Card key={slot.id} size="small" className="week-schedule-slot" bordered>
                      <Space direction="vertical" size={4} style={{ width: "100%" }}>
                        <Text strong>{slotTimeRangeLabel(slot)}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {slot.lessonTitle ?? "Без темы урока"}
                        </Text>
                        {slot.notes ? (
                          <Text style={{ fontSize: 12 }} ellipsis>
                            {slot.notes}
                          </Text>
                        ) : null}
                        {variant === "teacher" && slot.linkedAssignments && slot.linkedAssignments.length > 0 ? (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            Задания:{" "}
                            {slot.linkedAssignments
                              .map((a) => `${diaryKindLabels[a.kind] ?? a.kind}: ${a.title}`)
                              .join(" · ")}
                          </Text>
                        ) : null}
                        {variant === "student" &&
                        slot.linkedAssignments &&
                        slot.linkedAssignments.length > 0 &&
                        onStudentStartAssignment ? (
                          <Space direction="vertical" size={6} style={{ width: "100%" }}>
                            {slot.linkedAssignments.map((la) => {
                              const row = la.studentRow;
                              if (!row) {
                                return null;
                              }
                              const st = row.submission?.status ?? "not_started";
                              const hasProject = Boolean(row.submission?.projectId);
                              const sub = row.submission;
                              const graded = st === "graded" && sub != null && sub.score != null;
                              const scoreShown = graded ? sub.score : null;
                              const caption = diaryStudentAssignmentCaption(la.title, la.kind);
                              return (
                                <div key={la.id} className="week-schedule-slot__assignment">
                                  <Space align="start" wrap size={[6, 4]} style={{ width: "100%" }}>
                                    <Tag color={la.kind === "classwork" ? "blue" : "purple"}>
                                      {diaryKindLabels[la.kind] ?? (la.kind === "homework" ? "ДЗ" : la.kind)}
                                    </Tag>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      {caption ? (
                                        <Text strong style={{ fontSize: 12 }}>
                                          {caption}
                                        </Text>
                                      ) : null}
                                      {la.kind === "homework" && la.dueAt ? (
                                        <Text
                                          type={
                                            isOverdueByDueAt(la.dueAt, row.submission?.status ?? "not_started")
                                              ? "danger"
                                              : "secondary"
                                          }
                                          style={{ fontSize: 11, display: "block" }}
                                        >
                                          сдать до {dayjs(la.dueAt).format("DD.MM.YYYY")}
                                          {isOverdueByDueAt(la.dueAt, row.submission?.status ?? "not_started")
                                            ? " · просрочено"
                                            : ""}
                                        </Text>
                                      ) : null}
                                      {graded && scoreShown != null ? (
                                        <div className="week-schedule-slot__diary-grade">
                                          <Text type="secondary" style={{ fontSize: 11 }}>
                                            Оценка
                                          </Text>
                                          <Text strong className="week-schedule-slot__diary-grade-mark">
                                            {scoreShown}
                                          </Text>
                                          <Text type="secondary" style={{ fontSize: 11 }}>
                                            из {row.maxScore}
                                          </Text>
                                        </div>
                                      ) : st === "submitted" ? (
                                        <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
                                          У учителя на проверке
                                        </Text>
                                      ) : null}
                                      <Space wrap size="small" style={{ marginTop: 4 }}>
                                        <Tag color="default" style={{ margin: 0 }}>
                                          {diaryStatusLabels[st] ?? st}
                                        </Tag>
                                        {studentSlotNeedsAttention(row) ? (
                                          <Tag color="red" style={{ margin: 0 }}>
                                            Важно
                                          </Tag>
                                        ) : null}
                                        {st === "not_started" || !row.submission ? (
                                          <Button
                                            type="primary"
                                            size="small"
                                            onClick={() => onStudentStartAssignment(row)}
                                          >
                                            Открыть
                                          </Button>
                                        ) : null}
                                        {(st === "draft" || st === "needs_revision") && hasProject ? (
                                          <Button size="small" onClick={() => onStudentStartAssignment(row)}>
                                            Продолжить
                                          </Button>
                                        ) : null}
                                        {(st === "draft" || st === "needs_revision") &&
                                        hasProject &&
                                        onStudentSubmitAssignment ? (
                                          <Button size="small" onClick={() => onStudentSubmitAssignment(row)}>
                                            Сдать
                                          </Button>
                                        ) : null}
                                        {st === "graded" &&
                                        studentSlotNeedsAttention(row) &&
                                        onStudentMarkGradedSeen ? (
                                          <Button size="small" onClick={() => onStudentMarkGradedSeen(row)}>
                                            Понятно
                                          </Button>
                                        ) : null}
                                      </Space>
                                    </div>
                                  </Space>
                                </div>
                              );
                            })}
                          </Space>
                        ) : null}
                        {variant === "teacher" && (onEditSlot || onDeleteSlot) ? (
                          <Space size="small" wrap>
                            {onEditSlot ? (
                              <Button
                                type="link"
                                size="small"
                                style={{ padding: 0, height: "auto" }}
                                onClick={() => onEditSlot(slot.id)}
                              >
                                Редактировать
                              </Button>
                            ) : null}
                            {onDeleteSlot ? (
                              <>
                                <Popconfirm
                                  title="Удалить это занятие?"
                                  okText="Удалить"
                                  cancelText="Отмена"
                                  onConfirm={() => onDeleteSlot(slot.id)}
                                >
                                  <Button type="link" danger size="small" style={{ padding: 0, height: "auto" }}>
                                    Удалить
                                  </Button>
                                </Popconfirm>
                                {slot.weeklySeriesId && onDeleteSeries ? (
                                  <Popconfirm
                                    title="Удалить все занятия этой еженедельной серии?"
                                    okText="Удалить все"
                                    cancelText="Отмена"
                                    onConfirm={() => onDeleteSeries(slot.weeklySeriesId!)}
                                  >
                                    <Button type="link" size="small" style={{ padding: 0, height: "auto" }}>
                                      Вся серия
                                    </Button>
                                  </Popconfirm>
                                ) : null}
                              </>
                            ) : null}
                          </Space>
                        ) : null}
                        {variant === "student" && onAttendanceChange ? (
                          <div>
                            <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>
                              План на занятие (необязательно)
                            </Text>
                            <Select
                              size="small"
                              style={{ width: "100%" }}
                              disabled={slotStarted(slot.startsAt)}
                              value={
                                slot.myPlansToAttend === true
                                  ? "yes"
                                  : slot.myPlansToAttend === false
                                    ? "no"
                                    : "unset"
                              }
                              onChange={(v) =>
                                onAttendanceChange(slot.id, v === "unset" ? null : v === "yes")
                              }
                              options={[
                                { value: "unset", label: "Не отмечено" },
                                { value: "yes", label: "Планирую прийти" },
                                { value: "no", label: "Не смогу" }
                              ]}
                            />
                            {slotStarted(slot.startsAt) ? (
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                Занятие уже началось или прошло
                              </Text>
                            ) : null}
                          </div>
                        ) : null}
                      </Space>
                    </Card>
                  ))
                )}
              </Space>
            </Card>
          );
        })}
      </div>
    </Space>
  );
}
