import { Button, Card, Space, Spin, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "@/shared/api/client";
import type { HomeSchoolAssignmentRow } from "@/hooks/useHomeSchoolAssignments";
import {
  diaryKindLabels,
  diaryStatusLabels,
  diaryStudentAssignmentCaption,
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

  const homeworkAll = useMemo(() => {
    const list = rows.filter((r) => r.kind === "homework");
    list.sort((a, b) => {
      const da = a.dueAt ? dayjs(a.dueAt).valueOf() : Number.POSITIVE_INFINITY;
      const db = b.dueAt ? dayjs(b.dueAt).valueOf() : Number.POSITIVE_INFINITY;
      if (da !== db) {
        return da - db;
      }
      return a.title.localeCompare(b.title, "ru");
    });
    return list;
  }, [rows]);

  const startOrOpen = async (row: SlotStudentAssignmentRow) => {
    try {
      const res = await apiClient.post<{ projectId: string }>(
        `/api/student/assignments/${row.assignmentId}/start`,
        {}
      );
      navigate(`/studio?project=${encodeURIComponent(res.projectId)}`);
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

  return (
    <Card className="landing-home-homework" title="Домашние задания" size="small">
      {holder}
      <Spin spinning={loading}>
        {homeworkAll.length > 0 ? (
          <Space direction="vertical" size={8} style={{ width: "100%" }} className="landing-home-hw-list">
            {homeworkAll.map((r) => {
              const row = toSlotRow(r);
              const st = row.submission?.status ?? "not_started";
              const hasProject = Boolean(row.submission?.projectId);
              const sub = row.submission;
              const graded = st === "graded" && sub != null && sub.score != null;
              const scoreShown = graded ? sub.score : null;
              const caption = diaryStudentAssignmentCaption(r.title, "homework");
              return (
                <div key={r.assignmentId} className="week-schedule-slot__assignment">
                  <Space align="start" wrap size={[6, 4]} style={{ width: "100%" }}>
                    <Tag color="purple">{diaryKindLabels.homework}</Tag>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {caption ? (
                        <Text strong style={{ fontSize: 12 }}>
                          {caption}
                        </Text>
                      ) : null}
                      {r.dueAt ? (
                        <Text
                          type={
                            dayjs(r.dueAt).endOf("day").isBefore(dayjs()) &&
                            st !== "submitted" &&
                            st !== "graded"
                              ? "danger"
                              : "secondary"
                          }
                          style={{ fontSize: 11, display: "block" }}
                        >
                          сдать до {dayjs(r.dueAt).format("DD.MM.YYYY")}
                          {dayjs(r.dueAt).endOf("day").isBefore(dayjs()) &&
                          st !== "submitted" &&
                          st !== "graded"
                            ? " · срок прошёл"
                            : ""}
                        </Text>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 11, display: "block" }}>
                          без дедлайна
                        </Text>
                      )}
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
                          <Button type="primary" size="small" onClick={() => void startOrOpen(row)}>
                            Начать
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
                  </Space>
                </div>
              );
            })}
          </Space>
        ) : (
          <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
            Пока нет домашних заданий от учителя. Загляни в <Link to="/class">Обучение</Link> — там дневник и
            классные работы.
          </Paragraph>
        )}
        {homeworkAll.length > 0 ? (
          <Link to="/class" className="landing-home-homework__link">
            Открыть Обучение
          </Link>
        ) : null}
      </Spin>
    </Card>
  );
}
