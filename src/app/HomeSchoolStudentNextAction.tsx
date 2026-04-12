import { Alert, Button, Space, Typography, message } from "antd";
import dayjs from "dayjs";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/shared/api/client";
import type { HomeSchoolAssignmentRow } from "@/hooks/useHomeSchoolAssignments";
import {
  diaryKindLabels,
  diaryStatusLabels,
  studentSlotNeedsAttention,
  type SlotStudentAssignmentRow
} from "@/app/WeekScheduleCalendar";
import { pickNextSchoolAssignment } from "@/app/homeSchoolPickNextAssignment";

const { Text } = Typography;

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

export function HomeSchoolStudentNextAction({ rows, loading, onRefresh }: Props) {
  const [messageApi, messageHolder] = message.useMessage();
  const navigate = useNavigate();
  const next = useMemo(() => pickNextSchoolAssignment(rows), [rows]);

  if (loading || !next) {
    return null;
  }

  const row = toSlotRow(next);
  const st = row.submission?.status ?? "not_started";
  const hasProject = Boolean(row.submission?.projectId);
  const overdue =
    next.dueAt &&
    dayjs(next.dueAt).endOf("day").isBefore(dayjs()) &&
    st !== "submitted" &&
    st !== "graded";

  const startOrOpen = async () => {
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

  const submitWork = async () => {
    try {
      await apiClient.post(`/api/student/assignments/${row.assignmentId}/submit`, {});
      messageApi.success("Работа сдана");
      await onRefresh();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const markGradedSeen = async () => {
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

  const kindLabel = diaryKindLabels[next.kind] ?? next.kind;

  return (
    <>
      {messageHolder}
      <Alert
        type="info"
        showIcon
        className="landing-home-school-next"
        message="Следующее действие"
        description={
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            <div>
              <Text strong style={{ fontSize: 14 }}>
                {next.title}
              </Text>
              <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
                {kindLabel} · {next.classroomTitle}
                {next.dueAt ? ` · срок ${dayjs(next.dueAt).format("DD.MM")}` : ""}
                {overdue ? " · просрочено" : ""}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Статус: {diaryStatusLabels[st] ?? st}
                {studentSlotNeedsAttention(row) ? " · важно" : ""}
              </Text>
            </div>
            <Space wrap>
              {st === "not_started" || !row.submission ? (
                <Button type="primary" size="small" onClick={() => void startOrOpen()}>
                  Начать
                </Button>
              ) : null}
              {(st === "draft" || st === "needs_revision") && hasProject ? (
                <>
                  <Button size="small" onClick={() => void startOrOpen()}>
                    Продолжить
                  </Button>
                  <Button size="small" onClick={() => void submitWork()}>
                    Сдать
                  </Button>
                </>
              ) : null}
              {st === "graded" && studentSlotNeedsAttention(row) ? (
                <Button size="small" onClick={() => void markGradedSeen()}>
                  Понятно
                </Button>
              ) : null}
            </Space>
          </Space>
        }
      />
    </>
  );
}
