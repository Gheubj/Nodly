import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Empty, Select, Space, Spin, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link, useNavigate } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import { WeekScheduleCalendar, type SlotStudentAssignmentRow } from "@/app/WeekScheduleCalendar";
import dayjs from "dayjs";

const { Title, Paragraph, Text } = Typography;

interface StudentAssignmentRow {
  assignmentId: string;
  classroomId: string;
  classroomTitle: string;
  schoolName: string;
  title: string;
  kind: string;
  dueAt: string | null;
  maxScore: number;
  scheduleSlotId: string | null;
  submission: {
    id: string;
    status: string;
    score: number | null;
    projectId: string | null;
    gradedSeenAt: string | null;
    teacherNote: string | null;
    revisionNote: string | null;
  } | null;
}

interface StudentCourseLesson {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  studentSummary: string | null;
}

interface StudentCourseResponse {
  courseModule: string;
  courseHours: number;
  lessons: StudentCourseLesson[];
}

interface ScheduleSlotRow {
  id: string;
  startsAt: string;
  endsAt: string | null;
  durationMinutes?: number;
  notes: string | null;
  lessonTitle: string | null;
  myPlansToAttend?: boolean | null;
  linkedAssignments?: { id: string; title: string; kind: string; dueAt: string | null }[];
}

const STATUS_RU: Record<string, string> = {
  not_started: "Не начато",
  draft: "Черновик",
  submitted: "Сдано",
  needs_revision: "Нужна доработка",
  graded: "Оценено"
};

const KIND_RU: Record<string, string> = {
  classwork: "На уроке",
  homework: "Домашнее",
  project: "Проект"
};

function needsAttention(row: StudentAssignmentRow): boolean {
  const st = row.submission?.status ?? "not_started";
  if (st === "needs_revision") {
    return true;
  }
  if (st === "graded" && row.submission && !row.submission.gradedSeenAt) {
    return true;
  }
  return false;
}

function dueSortKey(dueAt: string | null): number {
  if (!dueAt) {
    return Number.MAX_SAFE_INTEGER;
  }
  return new Date(dueAt).getTime();
}

export function StudentClassPage() {
  const { user } = useSessionStore();
  const [messageApi, contextHolder] = message.useMessage();
  const navigate = useNavigate();
  const enrollments = user?.enrollments ?? [];
  const [assignments, setAssignments] = useState<StudentAssignmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [classFocusId, setClassFocusId] = useState<string>("");
  const [courseData, setCourseData] = useState<StudentCourseResponse | null>(null);
  const [scheduleRows, setScheduleRows] = useState<ScheduleSlotRow[]>([]);
  const [courseScheduleLoading, setCourseScheduleLoading] = useState(false);
  const [scheduleWeekAnchor, setScheduleWeekAnchor] = useState(() => dayjs());

  const loadAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiClient.get<StudentAssignmentRow[]>("/api/student/assignments");
      setAssignments(list);
    } catch {
      setAssignments([]);
      messageApi.error("Не удалось загрузить задания");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    if (user?.role === "student" && user.studentMode === "school") {
      void loadAssignments();
    }
  }, [user?.role, user?.studentMode, loadAssignments]);

  useEffect(() => {
    if (enrollments.length === 0) {
      return;
    }
    if (!classFocusId || !enrollments.some((e) => e.classroomId === classFocusId)) {
      setClassFocusId(enrollments[0].classroomId);
    }
  }, [enrollments, classFocusId]);

  useEffect(() => {
    if (!classFocusId) {
      setCourseData(null);
      setScheduleRows([]);
      return;
    }
    let cancelled = false;
    setCourseScheduleLoading(true);
    void (async () => {
      try {
        const [c, s] = await Promise.all([
          apiClient.get<StudentCourseResponse>(`/api/student/classrooms/${classFocusId}/course`),
          apiClient.get<ScheduleSlotRow[]>(`/api/student/classrooms/${classFocusId}/schedule`)
        ]);
        if (!cancelled) {
          setCourseData(c);
          setScheduleRows(s);
        }
      } catch {
        if (!cancelled) {
          setCourseData(null);
          setScheduleRows([]);
        }
      } finally {
        if (!cancelled) {
          setCourseScheduleLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classFocusId]);

  const assignmentsForClass = useMemo(
    () => assignments.filter((a) => a.classroomId === classFocusId),
    [assignments, classFocusId]
  );

  const focusEnrollment = useMemo(
    () => enrollments.find((e) => e.classroomId === classFocusId),
    [enrollments, classFocusId]
  );

  const assignmentById = useMemo(
    () => new Map(assignmentsForClass.map((a) => [a.assignmentId, a])),
    [assignmentsForClass]
  );

  const toSlotStudentRow = useCallback(
    (la: { id: string; title: string; kind: string; dueAt: string | null }): SlotStudentAssignmentRow => {
      const full = assignmentById.get(la.id);
      if (full) {
        return full as unknown as SlotStudentAssignmentRow;
      }
      return {
        assignmentId: la.id,
        classroomId: classFocusId,
        classroomTitle: focusEnrollment?.classroomTitle ?? "",
        schoolName: focusEnrollment?.schoolName ?? "",
        title: la.title,
        kind: la.kind,
        dueAt: la.dueAt,
        maxScore: 10,
        submission: null
      };
    },
    [assignmentById, classFocusId, focusEnrollment?.classroomTitle, focusEnrollment?.schoolName]
  );

  const upcomingRows = useMemo(() => {
    const rows = assignmentsForClass.filter((row) => (row.submission?.status ?? "not_started") !== "graded");
    return [...rows].sort((a, b) => dueSortKey(a.dueAt) - dueSortKey(b.dueAt));
  }, [assignmentsForClass]);

  const archiveRows = useMemo(() => {
    const rows = assignmentsForClass.filter((row) => {
      const st = row.submission?.status ?? "not_started";
      return st === "graded" || st === "submitted";
    });
    return [...rows].sort((a, b) => dueSortKey(b.dueAt) - dueSortKey(a.dueAt));
  }, [assignmentsForClass]);

  const otherUpcomingRows = useMemo(
    () => upcomingRows.filter((row) => !row.scheduleSlotId),
    [upcomingRows]
  );

  const otherArchiveRows = useMemo(
    () => archiveRows.filter((row) => !row.scheduleSlotId),
    [archiveRows]
  );

  const startOrOpen = async (row: StudentAssignmentRow) => {
    try {
      const res = await apiClient.post<{ projectId: string; submissionId: string; status: string }>(
        `/api/student/assignments/${row.assignmentId}/start`,
        {}
      );
      navigate(`/studio?project=${encodeURIComponent(res.projectId)}`);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const submitWork = async (row: StudentAssignmentRow) => {
    try {
      await apiClient.post(`/api/student/assignments/${row.assignmentId}/submit`, {});
      messageApi.success("Работа сдана");
      await loadAssignments();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const markGradedSeen = async (row: StudentAssignmentRow) => {
    const sid = row.submission?.id;
    if (!sid) {
      return;
    }
    try {
      await apiClient.post(`/api/student/submissions/${sid}/mark-graded-seen`, {});
      await loadAssignments();
    } catch {
      messageApi.error("Не удалось отметить просмотр");
    }
  };

  const updateSlotAttendance = useCallback(
    async (slotId: string, plansToAttend: boolean | null) => {
      try {
        await apiClient.patch(`/api/student/schedule-slots/${slotId}/attendance`, { plansToAttend });
        setScheduleRows((rows) =>
          rows.map((r) => (r.id === slotId ? { ...r, myPlansToAttend: plansToAttend } : r))
        );
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : "Не удалось сохранить отметку");
      }
    },
    [messageApi]
  );

  const assignmentColumns: ColumnsType<StudentAssignmentRow> = [
    {
      title: "Задание",
      key: "title",
      render: (_, row) => {
        const scoreSuffix =
          row.submission?.status === "graded" && row.submission.score != null
            ? ` (${row.submission.score}/${row.maxScore})`
            : "";
        return (
          <span>
            {row.title}
            {scoreSuffix}
          </span>
        );
      }
    },
    {
      title: "Тип",
      dataIndex: "kind",
      key: "kind",
      render: (k: string) => KIND_RU[k] ?? k
    },
    {
      title: "Срок",
      dataIndex: "dueAt",
      key: "dueAt",
      render: (d: string | null) => (d ? new Date(d).toLocaleDateString("ru-RU") : "—")
    },
    {
      title: "Статус",
      key: "st",
      render: (_, row) => {
        const st = row.submission?.status ?? "not_started";
        const color =
          st === "needs_revision" ? "orange" : st === "graded" ? "green" : st === "submitted" ? "blue" : "default";
        return (
          <Space size="small" wrap>
            <Tag color={color}>{STATUS_RU[st] ?? st}</Tag>
            {needsAttention(row) ? <Tag color="red">Новое</Tag> : null}
          </Space>
        );
      }
    },
    {
      title: "",
      key: "actions",
      width: 300,
      render: (_, row) => {
        const st = row.submission?.status ?? "not_started";
        const hasProject = Boolean(row.submission?.projectId);
        return (
          <Space wrap size="small">
            {st === "not_started" || !row.submission ? (
              <Button type="primary" size="small" onClick={() => void startOrOpen(row)}>
                Начать
              </Button>
            ) : null}
            {(st === "draft" || st === "needs_revision") && hasProject ? (
              <Button size="small" onClick={() => void startOrOpen(row)}>
                Открыть в разработке
              </Button>
            ) : null}
            {(st === "draft" || st === "needs_revision") && hasProject ? (
              <Button size="small" type="default" onClick={() => void submitWork(row)}>
                Сдать
              </Button>
            ) : null}
            {st === "graded" && needsAttention(row) ? (
              <Button size="small" onClick={() => void markGradedSeen(row)}>
                Понятно
              </Button>
            ) : null}
          </Space>
        );
      }
    }
  ];

  const expandableConfig = {
    expandedRowRender: (row: StudentAssignmentRow) => {
      const s = row.submission;
      if (!s) {
        return <Paragraph type="secondary">Начни задание, чтобы появился проект и комментарии учителя.</Paragraph>;
      }
      const parts = [s.revisionNote, s.teacherNote].filter(
        (x, i, a): x is string => Boolean(x) && a.indexOf(x) === i
      );
      if (parts.length === 0) {
        return <Paragraph type="secondary">Пока нет комментария от учителя.</Paragraph>;
      }
      return (
        <div style={{ maxWidth: 560 }}>
          <Text strong>Комментарий учителя:</Text>
          <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{parts.join("\n\n")}</Paragraph>
        </div>
      );
    },
    rowExpandable: (row: StudentAssignmentRow) => Boolean(row.submission)
  };

  if (!user) {
    return (
      <Empty description="Войдите, чтобы увидеть класс" image={Empty.PRESENTED_IMAGE_SIMPLE}>
        <Link to="/">На главную</Link>
      </Empty>
    );
  }

  if (enrollments.length === 0) {
    return (
      <Card>
        <Title level={5} style={{ marginTop: 0 }}>
          Ты ещё не в классе
        </Title>
        <Paragraph type="secondary">
          Попроси код у учителя и введи его в <Link to="/account">личном кабинете</Link> (раздел «Класс»).
        </Paragraph>
      </Card>
    );
  }

  const classPicker =
    enrollments.length > 1 ? (
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap align="center">
          <Text type="secondary">Класс:</Text>
          <Select
            style={{ minWidth: 260 }}
            value={classFocusId}
            onChange={(v) => setClassFocusId(v)}
            options={enrollments.map((e) => ({
              value: e.classroomId,
              label: `${e.classroomTitle} (${e.schoolName})`
            }))}
          />
        </Space>
      </Card>
    ) : null;

  const infoTab = (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {enrollments.map((e) => (
        <Card key={e.id} title={e.classroomTitle}>
          <Space direction="vertical" size="small">
            <div>
              <Text type="secondary">Школа / организация: </Text>
              <Text strong>{e.schoolName}</Text>
            </div>
            <div>
              <Text type="secondary">Учитель: </Text>
              <Text strong>{e.teacherNickname}</Text>
              <Text type="secondary"> ({e.teacherEmail})</Text>
            </div>
            <div>
              <Text type="secondary">Код класса (для одноклассников): </Text>
              <Text code>{e.classCode}</Text>
            </div>
          </Space>
        </Card>
      ))}
    </Space>
  );

  const courseTab = (
    <Spin spinning={courseScheduleLoading}>
      <Paragraph type="secondary">
        Модуль {courseData?.courseModule ?? "—"} · план {courseData?.courseHours ?? "—"} ч.
      </Paragraph>
      <Table<StudentCourseLesson>
        size="small"
        rowKey="id"
        dataSource={courseData?.lessons ?? []}
        pagination={false}
        locale={{ emptyText: "Нет данных курса" }}
        columns={[
          { title: "№", width: 48, render: (_, __, i) => i + 1 },
          { title: "Урок", dataIndex: "title", key: "title" },
          {
            title: "О чём урок",
            dataIndex: "studentSummary",
            key: "sum",
            render: (t: string | null) => t ?? "—"
          }
        ]}
      />
    </Spin>
  );

  const diaryTab = (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Title level={5} style={{ marginTop: 0 }}>
          Расписание и работы на занятиях
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          Здесь видно время урока, классная работа и домашка с дедлайном (если учитель добавил их к занятию).
          Ниже — задания, выданные отдельно от расписания.
        </Paragraph>
        <Spin spinning={courseScheduleLoading}>
          <WeekScheduleCalendar
            weekAnchor={scheduleWeekAnchor}
            onPrevWeek={() => setScheduleWeekAnchor((w) => w.subtract(1, "week"))}
            onNextWeek={() => setScheduleWeekAnchor((w) => w.add(1, "week"))}
            onThisWeek={() => setScheduleWeekAnchor(dayjs())}
            slots={scheduleRows.map((r) => ({
              id: r.id,
              startsAt: r.startsAt,
              durationMinutes: r.durationMinutes ?? 90,
              lessonTitle: r.lessonTitle,
              notes: r.notes,
              myPlansToAttend: r.myPlansToAttend,
              linkedAssignments: (r.linkedAssignments ?? []).map((la) => ({
                id: la.id,
                title: la.title,
                kind: la.kind,
                dueAt: la.dueAt,
                studentRow: toSlotStudentRow(la)
              }))
            }))}
            variant="student"
            onAttendanceChange={(slotId, value) => void updateSlotAttendance(slotId, value)}
            onStudentStartAssignment={(row) => void startOrOpen(row as unknown as StudentAssignmentRow)}
            onStudentSubmitAssignment={(row) => void submitWork(row as unknown as StudentAssignmentRow)}
            onStudentMarkGradedSeen={(row) => void markGradedSeen(row as unknown as StudentAssignmentRow)}
          />
        </Spin>
      </div>
      <div>
        <Title level={5} style={{ marginTop: 0 }}>
          Другие задания (вне расписания)
        </Title>
        <Table<StudentAssignmentRow>
          size="small"
          rowKey="assignmentId"
          loading={loading}
          columns={assignmentColumns}
          dataSource={otherUpcomingRows}
          pagination={{ pageSize: 8 }}
          locale={{ emptyText: "Нет других активных заданий" }}
          expandable={expandableConfig}
        />
      </div>
      <div>
        <Title level={5} style={{ marginTop: 0 }}>
          Сдано и оценки (вне расписания)
        </Title>
        <Table<StudentAssignmentRow>
          size="small"
          rowKey="assignmentId"
          loading={loading}
          columns={assignmentColumns}
          dataSource={otherArchiveRows}
          pagination={{ pageSize: 8 }}
          locale={{ emptyText: "Пока нет сданных работ в этом списке" }}
          expandable={expandableConfig}
        />
      </div>
    </Space>
  );

  const allAssignmentsTab = (
    <Table<StudentAssignmentRow>
      size="small"
      rowKey="assignmentId"
      loading={loading}
      columns={[
        ...assignmentColumns.slice(0, 1),
        { title: "Класс", dataIndex: "classroomTitle", key: "classroomTitle" },
        ...assignmentColumns.slice(1)
      ]}
      dataSource={assignments}
      pagination={{ pageSize: 10 }}
      locale={{ emptyText: "Пока нет заданий" }}
      expandable={expandableConfig}
    />
  );

  return (
    <>
      {contextHolder}
      {classPicker}
      <Tabs
        defaultActiveKey="diary"
        items={[
          { key: "course", label: "Курс", children: courseTab },
          { key: "diary", label: "Дневник", children: diaryTab },
          { key: "all", label: "Все задания", children: allAssignmentsTab },
          { key: "info", label: "Мой класс", children: infoTab }
        ]}
      />
    </>
  );
}
