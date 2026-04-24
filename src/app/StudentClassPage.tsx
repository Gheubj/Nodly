import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Select, Space, Spin, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link, useNavigate } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import { passedLessonTemplateIdsFromSlots } from "@/shared/scheduleSlotPast";
import { isOverdueByDueAt } from "@/shared/studentAssignmentDue";
import { WeekScheduleCalendar, type SlotStudentAssignmentRow } from "@/app/WeekScheduleCalendar";
import type { LessonContent } from "@/shared/types/lessonContent";
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
}

interface StudentCourseLesson {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  studentSummary: string | null;
  lessonContent?: LessonContent | null;
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
  lessonTemplateId: string | null;
  lessonTitle: string | null;
  myPlansToAttend?: boolean | null;
  linkedAssignments?: { id: string; title: string; kind: string; dueAt: string | null }[];
}

const STATUS_RU: Record<string, string> = {
  not_started: "Не начато",
  draft: "Черновик",
  submitted: "Сдано",
  auto_checked: "Проверено автоматически",
  pending_teacher_review: "На проверке у учителя",
  needs_revision: "Нужна доработка",
  graded: "Оценено"
};

const KIND_RU: Record<string, string> = {
  classwork: "Классная работа",
  homework: "ДЗ"
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
  const [allFilterGrade, setAllFilterGrade] = useState<"all" | "graded" | "not_graded">("all");
  const [allFilterKind, setAllFilterKind] = useState<"all" | "homework" | "classwork">("all");
  const [allFilterOverdue, setAllFilterOverdue] = useState<"all" | "overdue" | "not_overdue">("all");
  const [classTabKey, setClassTabKey] = useState("diary");

  useEffect(() => {
    const onTab = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (typeof key === "string" && key.trim()) {
        setClassTabKey(key);
      }
    };
    window.addEventListener("nodly-onboarding-student-class-tab", onTab as EventListener);
    return () => window.removeEventListener("nodly-onboarding-student-class-tab", onTab as EventListener);
  }, []);

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

  const passedLessonTemplateIds = useMemo(
    () => passedLessonTemplateIdsFromSlots(scheduleRows),
    [scheduleRows]
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
        lessonTemplateId: null,
        submission: null
      };
    },
    [assignmentById, classFocusId, focusEnrollment?.classroomTitle, focusEnrollment?.schoolName]
  );

  const startOrOpen = async (row: StudentAssignmentRow) => {
    try {
      if (!row.lessonTemplateId) {
        throw new Error("У задания не указан урок (lessonTemplateId). Попроси учителя привязать урок к заданию.");
      }
      await apiClient.post(`/api/student/assignments/${row.assignmentId}/start`, {});
      navigate(
        `/lesson/${encodeURIComponent(row.lessonTemplateId)}?assignmentId=${encodeURIComponent(row.assignmentId)}`
      );
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const submitWork = async (row: StudentAssignmentRow) => {
    try {
      await apiClient.post(`/api/student/assignments/${row.assignmentId}/submit`, {});
      messageApi.success(user?.studentMode === "school" ? "Работа сдана учителю" : "Работа сдана");
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
      dataIndex: "title"
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
      render: (d: string | null, row) => {
        const st = row.submission?.status ?? "not_started";
        const overdueHw =
          row.kind === "homework" && d && isOverdueByDueAt(d, st);
        return (
          <Text type={overdueHw ? "danger" : undefined}>
            {d ? new Date(d).toLocaleDateString("ru-RU") : "—"}
          </Text>
        );
      }
    },
    {
      title: "Статус",
      key: "st",
      render: (_, row) => {
        const st = row.submission?.status ?? "not_started";
        const color =
          st === "needs_revision"
            ? "orange"
            : st === "graded" || st === "auto_checked"
              ? "green"
              : st === "submitted" || st === "pending_teacher_review"
                ? "blue"
                : "default";
        const overdueHw = row.kind === "homework" && isOverdueByDueAt(row.dueAt, st);
        return (
          <Space size="small" wrap>
            {overdueHw ? (
              <Tag color="red">Просрочено</Tag>
            ) : null}
            <Tag color={color}>{STATUS_RU[st] ?? st}</Tag>
            {needsAttention(row) ? <Tag color="red">Новое</Tag> : null}
          </Space>
        );
      }
    },
    {
      title: "Оценка",
      key: "grade",
      width: 108,
      render: (_, row) => {
        const st = row.submission?.status ?? "not_started";
        if ((st === "graded" || st === "auto_checked") && row.submission?.score != null) {
          return (
            <Text strong>
              {row.submission.score}/{row.maxScore}
            </Text>
          );
        }
        if (st === "submitted" || st === "pending_teacher_review") {
          return (
            <Text type="secondary" style={{ fontSize: 12 }}>
              На проверке
            </Text>
          );
        }
        return <Text type="secondary">—</Text>;
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
                Открыть
              </Button>
            ) : null}
            {(st === "draft" || st === "needs_revision") && hasProject ? (
              <Button size="small" onClick={() => void startOrOpen(row)}>
                Продолжить
              </Button>
            ) : null}
            {(st === "draft" || st === "needs_revision") && hasProject ? (
              <Button size="small" type="default" onClick={() => void submitWork(row)}>
                {user?.studentMode === "school" ? "Сдать учителю" : "Сдать"}
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
          Попроси код у учителя и введи его в <Link to="/account">личном кабинете</Link> (блок «Код класса»).
        </Paragraph>
      </Card>
    );
  }

  const classPicker =
    enrollments.length > 1 ? (
      <Card size="small" style={{ marginBottom: 16 }} className="student-class-page__picker-card">
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
    <div data-onboarding="student-class-info">
    <Space direction="vertical" size="large" style={{ width: "100%" }} className="student-class-page__info-tab">
      {enrollments.map((e) => (
        <Card key={e.id} title={e.classroomTitle} className="student-class-page__info-card">
          <Space direction="vertical" size="small">
            <div>
              <Text type="secondary">Школа / организация: </Text>
              <Text strong>{e.schoolName}</Text>
            </div>
            <div>
              <Text type="secondary">Учитель: </Text>
              <Text strong>{e.teacherNickname}</Text>
            </div>
            <div>
              <Text type="secondary">Код класса (для одноклассников): </Text>
              <Text code>{e.classCode}</Text>
            </div>
          </Space>
        </Card>
      ))}
    </Space>
    </div>
  );

  const courseTab = (
    <div data-onboarding="student-class-course">
    <Card className="student-class-page__course-card">
      <Spin spinning={courseScheduleLoading}>
        <Paragraph type="secondary" className="student-class-page__course-meta">
          Модуль {courseData?.courseModule ?? "—"} · план {courseData?.courseHours ?? "—"} ч.
        </Paragraph>
        <Table<StudentCourseLesson>
          size="small"
          rowKey="id"
          className="student-class-page__table student-class-page__table--course"
          dataSource={courseData?.lessons ?? []}
          pagination={false}
          locale={{ emptyText: "Нет данных курса" }}
          columns={[
            {
              title: "",
              key: "passed",
              width: 40,
              align: "center",
              render: (_, row: StudentCourseLesson) =>
                passedLessonTemplateIds.has(row.id) ? (
                  <CheckOutlined style={{ color: "var(--ant-color-success)" }} aria-label="Урок проведён" />
                ) : null
            },
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
    </Card>
    </div>
  );


  const filteredAllAssignments = useMemo(() => {
    return assignments.filter((row) => {
      const st = row.submission?.status ?? "not_started";
      if (allFilterGrade === "graded" && st !== "graded" && st !== "auto_checked") {
        return false;
      }
      if (allFilterGrade === "not_graded" && (st === "graded" || st === "auto_checked")) {
        return false;
      }
      if (allFilterKind !== "all" && row.kind !== allFilterKind) {
        return false;
      }
      const hwOverdue = row.kind === "homework" && isOverdueByDueAt(row.dueAt, st);
      if (allFilterOverdue === "overdue" && !hwOverdue) {
        return false;
      }
      if (allFilterOverdue === "not_overdue" && hwOverdue) {
        return false;
      }
      return true;
    });
  }, [assignments, allFilterGrade, allFilterKind, allFilterOverdue]);

  const diaryTab = (
    <div data-onboarding="student-class-diary">
    <Card className="student-class-page__diary-card">
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Title level={5} style={{ marginTop: 0 }}>
          Расписание и работы на занятиях
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          Время урока, работы на занятии и домашние задания — в карточках по дням. Выставленная оценка показывается в
          дневнике под заданием; полный список с фильтрами — во вкладке «Все задания».
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
              endsAt: r.endsAt,
              durationMinutes: r.durationMinutes ?? 90,
              lessonTemplateId: r.lessonTemplateId,
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
      </Space>
    </Card>
    </div>
  );

  const allAssignmentsTab = (
    <div data-onboarding="student-class-all-assignments">
    <Card className="student-class-page__assignments-card">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap align="center" className="student-class-page__filters">
        <Text type="secondary">Фильтры:</Text>
        <Select
          value={allFilterGrade}
          onChange={(v) => setAllFilterGrade(v)}
          style={{ minWidth: 200 }}
          options={[
            { value: "all", label: "Все задания" },
            { value: "graded", label: "С оценкой" },
            { value: "not_graded", label: "Без оценки" }
          ]}
        />
        <Select
          value={allFilterKind}
          onChange={(v) => setAllFilterKind(v)}
          style={{ minWidth: 200 }}
          options={[
            { value: "all", label: "Все типы" },
            { value: "homework", label: "ДЗ" },
            { value: "classwork", label: "Классная работа" }
          ]}
        />
        <Select
          value={allFilterOverdue}
          onChange={(v) => setAllFilterOverdue(v)}
          style={{ minWidth: 220 }}
          options={[
            { value: "all", label: "Просрочка: все" },
            { value: "overdue", label: "Только просроченные ДЗ" },
            { value: "not_overdue", label: "Только без просрочки" }
          ]}
        />
      </Space>
      <Table<StudentAssignmentRow>
        size="small"
        className="student-class-page__table student-class-page__table--assignments"
        rowKey="assignmentId"
        loading={loading}
        columns={[
          ...assignmentColumns.slice(0, 1),
          { title: "Класс", dataIndex: "classroomTitle", key: "classroomTitle", ellipsis: true },
          ...assignmentColumns.slice(1)
        ]}
        dataSource={filteredAllAssignments}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: "Нет заданий по выбранным фильтрам" }}
        expandable={expandableConfig}
      />
    </Space>
    </Card>
    </div>
  );

  return (
    <div className="student-class-page">
      {contextHolder}
      {classPicker}
      <Tabs
        className="student-class-page__tabs"
        activeKey={classTabKey}
        onChange={setClassTabKey}
        items={[
          { key: "course", label: "Курс", children: courseTab },
          { key: "diary", label: "Дневник", children: diaryTab },
          { key: "all", label: "Все задания", children: allAssignmentsTab },
          { key: "info", label: "Мой класс", children: infoTab }
        ]}
      />
    </div>
  );
}
