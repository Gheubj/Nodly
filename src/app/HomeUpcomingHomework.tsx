import { Button, Card, Space, Spin, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/shared/api/client";
import { computeSlidingDayColumns, lastHomeworkDueAnchorDay } from "@/shared/homeCalendarWindow";
import { isOverdueByDueAt, submissionStatusUnfinished } from "@/shared/studentAssignmentDue";
import type { HomeSchoolAssignmentRow } from "@/hooks/useHomeSchoolAssignments";
import {
  diaryStatusLabels,
  studentSlotNeedsAttention,
  type SlotStudentAssignmentRow
} from "@/app/WeekScheduleCalendar";

const { Text, Paragraph } = Typography;

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

type Props = {
  rows: HomeSchoolAssignmentRow[];
  loading: boolean;
  onRefresh: () => void | Promise<void>;
};

export function HomeUpcomingHomework({ rows, loading, onRefresh }: Props) {
  const [messageApi, holder] = message.useMessage();
  const navigate = useNavigate();

  const hasVisibleHomeworkInDefaultWindow = useMemo(() => {
    const start = dayjs().startOf("day");
    const end = start.add(3, "day").endOf("day");
    return rows.some((r) => {
      if (r.kind !== "homework" || !r.dueAt) {
        return false;
      }
      const st = r.submission?.status ?? "not_started";
      if (!submissionStatusUnfinished(st) || isOverdueByDueAt(r.dueAt, st)) {
        return false;
      }
      const due = dayjs(r.dueAt).endOf("day");
      return !due.isBefore(start) && !due.isAfter(end);
    });
  }, [rows]);

  const columns = useMemo(() => {
    const anchor = hasVisibleHomeworkInDefaultWindow ? null : lastHomeworkDueAnchorDay(rows);
    return computeSlidingDayColumns(anchor);
  }, [rows, hasVisibleHomeworkInDefaultWindow]);

  const rowsByDueDay = useMemo(() => {
    const keys = new Set(columns.map((d) => d.format("YYYY-MM-DD")));
    const map = new Map<string, HomeSchoolAssignmentRow[]>();
    for (const k of keys) {
      map.set(k, []);
    }
    for (const r of rows) {
      if (r.kind !== "homework" || !r.dueAt) {
        continue;
      }
      const st = r.submission?.status ?? "not_started";
      if (!submissionStatusUnfinished(st)) {
        continue;
      }
      if (isOverdueByDueAt(r.dueAt, st)) {
        continue;
      }
      const k = dayjs(r.dueAt).format("YYYY-MM-DD");
      if (!map.has(k)) {
        continue;
      }
      map.get(k)!.push(r);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.title.localeCompare(b.title, "ru"));
    }
    return map;
  }, [rows, columns]);

  const undatedUnfinished = useMemo(() => {
    return rows.filter((r) => {
      if (r.kind !== "homework" || r.dueAt) {
        return false;
      }
      const st = r.submission?.status ?? "not_started";
      return submissionStatusUnfinished(st);
    });
  }, [rows]);

  const todayKey = dayjs().format("YYYY-MM-DD");

  const startOrOpen = async (row: SlotStudentAssignmentRow) => {
    try {
      await apiClient.post<{ projectId: string }>(
        `/api/student/assignments/${row.assignmentId}/start`,
        {}
      );
      if (!row.lessonTemplateId) {
        messageApi.error("У задания не указан урок. Попроси учителя привязать урок к заданию.");
        return;
      }
      navigate(
        `/lesson/${encodeURIComponent(row.lessonTemplateId)}?assignmentId=${encodeURIComponent(row.assignmentId)}`
      );
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const submitWork = async (row: SlotStudentAssignmentRow) => {
    try {
      await apiClient.post(`/api/student/assignments/${row.assignmentId}/submit`, {});
      messageApi.success("Работа сдана");
      await onRefresh();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const markGradedSeen = async (row: SlotStudentAssignmentRow) => {
    const sid = row.submission?.id;
    if (!sid) {
      return;
    }
    try {
      await apiClient.post(`/api/student/submissions/${sid}/mark-graded-seen`, {});
      await onRefresh();
    } catch {
      messageApi.error("Не удалось отметить просмотр");
    }
  };

  const renderHwSlot = (r: HomeSchoolAssignmentRow) => {
    const row = toSlotRow(r);
    const st = row.submission?.status ?? "not_started";
    const hasProject = Boolean(row.submission?.projectId);
    const sub = row.submission;
    const graded = st === "graded" && sub != null && sub.score != null;
    const scoreShown = graded ? sub.score : null;
    return (
      <div key={r.assignmentId} className="landing-home-schedule__slot">
        <Text strong style={{ fontSize: 12, display: "block", lineHeight: 1.35 }}>
          {r.classroomTitle}
        </Text>
        <Text style={{ fontSize: 12, display: "block", marginTop: 4, lineHeight: 1.35 }}>
          {r.title}
        </Text>
        {graded && scoreShown != null ? (
          <Text type="success" style={{ fontSize: 11, display: "block", marginTop: 2 }}>
            {scoreShown}/{row.maxScore}
          </Text>
        ) : null}
        {st === "submitted" && !graded ? (
          <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 2 }}>
            на проверке
          </Text>
        ) : null}
        <Tag color="default" style={{ margin: "6px 0 0 0", fontSize: 11 }}>
          {diaryStatusLabels[st] ?? st}
        </Tag>
        {studentSlotNeedsAttention(row) ? (
          <Tag color="red" style={{ margin: "4px 0 0 0", fontSize: 11 }}>
            Важно
          </Tag>
        ) : null}
        <Space size={4} wrap style={{ marginTop: 6 }}>
          {st === "not_started" || !row.submission ? (
            <Button type="primary" size="small" onClick={() => void startOrOpen(row)}>
              Открыть
            </Button>
          ) : null}
          {(st === "draft" || st === "needs_revision") && hasProject ? (
            <Button size="small" onClick={() => void startOrOpen(row)}>
              Продолжить
            </Button>
          ) : null}
          {(st === "draft" || st === "needs_revision") && hasProject ? (
            <Button size="small" onClick={() => void submitWork(row)}>
              Сдать
            </Button>
          ) : null}
          {st === "graded" && studentSlotNeedsAttention(row) ? (
            <Button size="small" onClick={() => void markGradedSeen(row)}>
              Понятно
            </Button>
          ) : null}
        </Space>
      </div>
    );
  };

  return (
    <Card className="landing-home-homework landing-home-schedule" title="Ближайшие ДЗ" size="small">
      {holder}
      <Spin spinning={loading}>
        <div className="landing-home-schedule__grid">
          {columns.map((d) => {
            const key = d.format("YYYY-MM-DD");
            const dayRows = rowsByDueDay.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className={`landing-home-schedule__day${isToday ? " landing-home-schedule__day--today" : ""}`}
              >
                <Text strong className="landing-home-schedule__day-title">
                  {isToday ? "Сегодня" : d.format("dd, D MMM")}
                </Text>
                <div className="landing-home-schedule__slots">
                  {dayRows.length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Нет ДЗ
                    </Text>
                  ) : (
                    dayRows.map((r) => renderHwSlot(r))
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {undatedUnfinished.length > 0 ? (
          <Paragraph style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            <Text strong>Без указанного срока: </Text>
            {undatedUnfinished.map((r) => r.title).join(", ")}
          </Paragraph>
        ) : null}
      </Spin>
    </Card>
  );
}
