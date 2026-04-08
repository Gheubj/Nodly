import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link, useLocation } from "react-router-dom";
import { CopyOutlined, TeamOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

interface DashboardSchool {
  id: string;
  name: string;
}

interface DashboardStudent {
  enrollmentId: string;
  joinedAt: string;
  id: string;
  nickname: string;
  email: string;
}

interface DashboardClassroom {
  id: string;
  title: string;
  code: string;
  schoolId: string;
  schoolName: string;
  createdAt: string;
  students: DashboardStudent[];
}

interface TeacherDashboard {
  schools: DashboardSchool[];
  classrooms: DashboardClassroom[];
}

interface TeacherAssignmentRow {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  maxScore: number;
  published: boolean;
  dueAt: string | null;
  createdAt: string;
  submissionsCount: number;
}

interface TeacherSubmissionRow {
  id: string;
  status: string;
  score: number | null;
  teacherNote: string | null;
  revisionNote: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  projectId: string | null;
  student: { id: string; nickname: string; email: string };
  assignment: { id: string; title: string; maxScore: number };
}

interface LessonTemplateListItem {
  id: string;
  title: string;
  description: string | null;
  moduleKey: string;
  sortOrder: number;
}

interface GradebookResponse {
  students: { id: string; nickname: string }[];
  assignments: { id: string; title: string; maxScore: number; kind: string }[];
  cells: { studentId: string; assignmentId: string; score: number | null; status: string }[];
}

const SUBMISSION_STATUS_RU: Record<string, string> = {
  not_started: "Не начато",
  draft: "Черновик",
  submitted: "Сдано",
  needs_revision: "Доработка",
  graded: "Оценено"
};

const KIND_RU: Record<string, string> = {
  classwork: "На уроке",
  homework: "Домашнее",
  project: "Проект"
};

export function TeacherPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const { user } = useSessionStore();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState("classes");
  const [tabBadges, setTabBadges] = useState({ newEnroll: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<TeacherDashboard | null>(null);
  const [schoolModalOpen, setSchoolModalOpen] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [classModalOpen, setClassModalOpen] = useState(false);
  const [classTitle, setClassTitle] = useState("");
  const [classSchoolId, setClassSchoolId] = useState<string>("");

  const [lmsClassroomId, setLmsClassroomId] = useState<string>("");
  const [assignments, setAssignments] = useState<TeacherAssignmentRow[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [submissions, setSubmissions] = useState<TeacherSubmissionRow[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [filterAssignmentId, setFilterAssignmentId] = useState<string | undefined>();
  const [templates, setTemplates] = useState<LessonTemplateListItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<TeacherAssignmentRow | null>(null);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [gradingSubmission, setGradingSubmission] = useState<TeacherSubmissionRow | null>(null);
  const [gradebook, setGradebook] = useState<GradebookResponse | null>(null);
  const [gradebookLoading, setGradebookLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [gradeForm] = Form.useForm();
  const [adminStarterJson, setAdminStarterJson] = useState(
    JSON.stringify(
      {
        imageDatasets: [],
        tabularDatasets: [],
        imagePredictionInputs: [],
        tabularPredictionInputs: [],
        savedModels: [],
        blocklyState: ""
      },
      null,
      2
    )
  );
  const [adminSubmitting, setAdminSubmitting] = useState(false);

  const syncTeacherBadges = useCallback(async () => {
    try {
      const s = await apiClient.get<{ newEnrollmentCount?: number; pendingReviewCount?: number }>(
        "/api/me/summary"
      );
      setTabBadges({ newEnroll: s.newEnrollmentCount ?? 0, pending: s.pendingReviewCount ?? 0 });
    } catch {
      setTabBadges({ newEnroll: 0, pending: 0 });
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<TeacherDashboard>("/api/teacher/dashboard");
      setDashboard(data);
      setClassSchoolId((prev) => prev || data.schools[0]?.id || "");
      setLmsClassroomId((prev) => {
        if (prev) {
          return prev;
        }
        return data.classrooms[0]?.id ?? "";
      });
    } catch {
      setDashboard(null);
      messageApi.error("Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    if (user?.role === "teacher") {
      void syncTeacherBadges();
    }
  }, [user?.role, location.pathname, syncTeacherBadges]);

  const handleTeacherTabChange = (key: string) => {
    setActiveTab(key);
  };

  /** Срабатывает и при повторном клике по уже открытой вкладке — можно сбросить бейдж, не переключаясь */
  const handleTeacherTabClick = (key: string) => {
    if (key === "classes") {
      void (async () => {
        try {
          await apiClient.post("/api/teacher/mark-new-enrollments-seen", {});
          await syncTeacherBadges();
          window.dispatchEvent(new Event("nodly-refresh-header-summary"));
        } catch {
          messageApi.error("Не удалось обновить отметки");
        }
      })();
    }
    if (key === "assignments") {
      void (async () => {
        try {
          await apiClient.post("/api/teacher/mark-assignments-queue-seen", {});
          await syncTeacherBadges();
          window.dispatchEvent(new Event("nodly-refresh-header-summary"));
        } catch {
          messageApi.error("Не удалось обновить отметки");
        }
      })();
    }
  };

  const loadAssignments = useCallback(
    async (classroomId: string) => {
      if (!classroomId) {
        setAssignments([]);
        return;
      }
      setAssignmentsLoading(true);
      try {
        const list = await apiClient.get<TeacherAssignmentRow[]>(
          `/api/teacher/classrooms/${classroomId}/assignments`
        );
        setAssignments(list);
      } catch {
        setAssignments([]);
        messageApi.error("Не удалось загрузить задания");
      } finally {
        setAssignmentsLoading(false);
      }
    },
    [messageApi]
  );

  const loadSubmissions = useCallback(
    async (classroomId: string, assignmentId?: string) => {
      if (!classroomId) {
        setSubmissions([]);
        return;
      }
      setSubmissionsLoading(true);
      try {
        const q = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : "";
        const list = await apiClient.get<TeacherSubmissionRow[]>(
          `/api/teacher/classrooms/${classroomId}/submissions${q}`
        );
        setSubmissions(list);
      } catch {
        setSubmissions([]);
        messageApi.error("Не удалось загрузить сдачи");
      } finally {
        setSubmissionsLoading(false);
      }
    },
    [messageApi]
  );

  const loadGradebook = useCallback(
    async (classroomId: string) => {
      if (!classroomId) {
        setGradebook(null);
        return;
      }
      setGradebookLoading(true);
      try {
        const data = await apiClient.get<GradebookResponse>(
          `/api/teacher/classrooms/${classroomId}/gradebook`
        );
        setGradebook(data);
      } catch {
        setGradebook(null);
        messageApi.error("Не удалось загрузить журнал");
      } finally {
        setGradebookLoading(false);
      }
    },
    [messageApi]
  );

  useEffect(() => {
    if (user?.role === "teacher") {
      void loadDashboard();
    }
  }, [user?.role, loadDashboard]);

  useEffect(() => {
    void (async () => {
      try {
        const list = await apiClient.get<LessonTemplateListItem[]>("/api/lesson-templates");
        setTemplates(list);
      } catch {
        setTemplates([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (lmsClassroomId) {
      void loadAssignments(lmsClassroomId);
      void loadSubmissions(lmsClassroomId, filterAssignmentId);
      void loadGradebook(lmsClassroomId);
    }
  }, [lmsClassroomId, filterAssignmentId, loadAssignments, loadSubmissions, loadGradebook]);

  const handleCreateSchool = async () => {
    const name = schoolName.trim();
    if (name.length < 2) {
      messageApi.error("Название школы — минимум 2 символа");
      return;
    }
    try {
      await apiClient.post("/api/schools", { name });
      messageApi.success("Школа создана");
      setSchoolModalOpen(false);
      setSchoolName("");
      await loadDashboard();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const handleCreateClass = async () => {
    const titleTrim = classTitle.trim();
    if (titleTrim.length < 2) {
      messageApi.error("Название класса — минимум 2 символа");
      return;
    }
    if (!classSchoolId) {
      messageApi.error("Сначала создайте школу");
      return;
    }
    try {
      await apiClient.post("/api/classrooms", { schoolId: classSchoolId, title: titleTrim });
      messageApi.success("Класс создан, код для учеников сгенерирован");
      setClassModalOpen(false);
      setClassTitle("");
      await loadDashboard();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const copyCode = (code: string) => {
    void navigator.clipboard.writeText(code);
    messageApi.success("Код скопирован");
  };

  const openCreateModal = () => {
    createForm.resetFields();
    createForm.setFieldsValue({
      kind: "homework",
      maxScore: 10,
      published: true
    });
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      const due = v.dueAt as dayjs.Dayjs | null | undefined;
      await apiClient.post(`/api/teacher/classrooms/${lmsClassroomId}/assignments`, {
        title: v.title as string,
        description: v.description as string | undefined,
        kind: v.kind as string,
        maxScore: v.maxScore as number,
        published: Boolean(v.published),
        dueAt: due ? due.endOf("day").toISOString() : null,
        lessonTemplateId: v.lessonTemplateId ?? null
      });
      messageApi.success("Задание создано");
      setCreateOpen(false);
      await loadAssignments(lmsClassroomId);
    } catch (e) {
      if (e instanceof Error) {
        messageApi.error(e.message);
      }
    }
  };

  const openEdit = (row: TeacherAssignmentRow) => {
    setEditingAssignment(row);
    editForm.setFieldsValue({
      title: row.title,
      description: row.description ?? "",
      kind: row.kind,
      maxScore: row.maxScore,
      published: row.published,
      dueAt: row.dueAt ? dayjs(row.dueAt) : null
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!editingAssignment) {
      return;
    }
    try {
      const v = await editForm.validateFields();
      const due = v.dueAt as dayjs.Dayjs | null | undefined;
      await apiClient.patch(`/api/teacher/assignments/${editingAssignment.id}`, {
        title: v.title as string,
        description: (v.description as string) || null,
        kind: v.kind as string,
        maxScore: v.maxScore as number,
        published: Boolean(v.published),
        dueAt: due ? due.endOf("day").toISOString() : null
      });
      messageApi.success("Сохранено");
      setEditOpen(false);
      setEditingAssignment(null);
      await loadAssignments(lmsClassroomId);
    } catch (e) {
      if (e instanceof Error) {
        messageApi.error(e.message);
      }
    }
  };

  const openGrade = (row: TeacherSubmissionRow) => {
    setGradingSubmission(row);
    gradeForm.setFieldsValue({
      decision: "grade",
      score: row.score ?? row.assignment.maxScore,
      comment: row.revisionNote || row.teacherNote || ""
    });
    setGradeOpen(true);
    if (row.status === "submitted") {
      void apiClient.post("/api/teacher/submissions/mark-seen", { submissionIds: [row.id] }).catch(() => {});
    }
  };

  const submitGrade = async () => {
    if (!gradingSubmission) {
      return;
    }
    try {
      const v = await gradeForm.validateFields();
      const commentRaw = typeof v.comment === "string" ? v.comment.trim() : "";
      const comment = commentRaw.length > 0 ? commentRaw : null;
      await apiClient.post(`/api/teacher/submissions/${gradingSubmission.id}/grade`, {
        decision: v.decision,
        score: v.decision === "grade" ? v.score : null,
        teacherNote: v.decision === "grade" ? comment : null,
        revisionNote: v.decision === "revision" ? comment : null
      });
      messageApi.success("Готово");
      setGradeOpen(false);
      setGradingSubmission(null);
      await loadSubmissions(lmsClassroomId, filterAssignmentId);
      await syncTeacherBadges();
      window.dispatchEvent(new Event("nodly-refresh-header-summary"));
    } catch (e) {
      if (e instanceof Error) {
        messageApi.error(e.message);
      }
    }
  };

  const submitAdminTemplate = async (vals: {
    title: string;
    moduleKey: string;
    sortOrder?: number;
    description?: string;
    published?: boolean;
  }) => {
    let starterPayload: Record<string, unknown>;
    try {
      starterPayload = JSON.parse(adminStarterJson) as Record<string, unknown>;
    } catch {
      messageApi.error("Некорректный JSON снапшота");
      return;
    }
    setAdminSubmitting(true);
    try {
      await apiClient.post("/api/admin/lesson-templates", {
        title: vals.title,
        description: vals.description,
        moduleKey: vals.moduleKey,
        sortOrder: vals.sortOrder ?? 0,
        starterPayload,
        published: vals.published ?? true
      });
      messageApi.success("Шаблон создан");
      const list = await apiClient.get<LessonTemplateListItem[]>("/api/lesson-templates");
      setTemplates(list);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setAdminSubmitting(false);
    }
  };

  const studentColumns: ColumnsType<DashboardStudent> = [
    { title: "Ник", dataIndex: "nickname", key: "nickname" },
    { title: "Email", dataIndex: "email", key: "email" },
    {
      title: "В классе с",
      dataIndex: "joinedAt",
      key: "joinedAt",
      render: (v: string) => new Date(v).toLocaleString("ru-RU")
    }
  ];

  const assignmentColumns: ColumnsType<TeacherAssignmentRow> = [
    { title: "Название", dataIndex: "title", key: "title" },
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
      title: "Сдачи",
      dataIndex: "submissionsCount",
      key: "submissionsCount"
    },
    {
      title: "",
      key: "actions",
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => openEdit(row)}>
          Изменить
        </Button>
      )
    }
  ];

  const submissionColumns: ColumnsType<TeacherSubmissionRow> = [
    { title: "Ученик", key: "st", render: (_, r) => r.student.nickname },
    { title: "Задание", key: "as", render: (_, r) => r.assignment.title },
    {
      title: "Статус",
      dataIndex: "status",
      key: "status",
      render: (s: string) => SUBMISSION_STATUS_RU[s] ?? s
    },
    {
      title: "Балл",
      key: "score",
      render: (_, r) =>
        r.score != null && r.assignment.maxScore != null ? `${r.score}/${r.assignment.maxScore}` : "—"
    },
    {
      title: "",
      key: "go",
      render: (_, r) => (
        <Space size="small" wrap>
          {r.projectId ? (
            <Link to={`/studio?reviewSubmission=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer">
              Открыть работу
            </Link>
          ) : null}
          {r.status === "submitted" || r.status === "needs_revision" || r.status === "draft" ? (
            <Button type="link" size="small" onClick={() => openGrade(r)}>
              Оценить
            </Button>
          ) : r.status === "graded" ? (
            <Button type="link" size="small" onClick={() => openGrade(r)}>
              Изменить оценку
            </Button>
          ) : null}
        </Space>
      )
    }
  ];

  const cellMap = useMemo(() => {
    if (!gradebook) {
      return new Map<string, GradebookResponse["cells"][0]>();
    }
    const m = new Map<string, GradebookResponse["cells"][0]>();
    for (const c of gradebook.cells) {
      m.set(`${c.studentId}_${c.assignmentId}`, c);
    }
    return m;
  }, [gradebook]);

  const gradebookColumns: ColumnsType<{ id: string; nickname: string }> = useMemo(() => {
    if (!gradebook) {
      return [{ title: "Ученик", dataIndex: "nickname", key: "nick", fixed: "left" as const }];
    }
    const base: ColumnsType<{ id: string; nickname: string }> = [
      { title: "Ученик", dataIndex: "nickname", key: "nick", fixed: "left", width: 140 }
    ];
    for (const a of gradebook.assignments) {
      base.push({
        title: `${a.title}`,
        key: a.id,
        width: 100,
        render: (_, row) => {
          const c = cellMap.get(`${row.id}_${a.id}`);
          if (!c || c.status === "not_started") {
            return "—";
          }
          if (c.status === "graded" && c.score != null) {
            return `${c.score}`;
          }
          return SUBMISSION_STATUS_RU[c.status] ?? c.status;
        }
      });
    }
    return base;
  }, [gradebook, cellMap]);

  if (!user) {
    return (
      <div className="app-content account-page">
        <Card>
          <Paragraph>Войдите как учитель.</Paragraph>
          <Link to="/">
            <Button type="primary">На главную</Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (user.role !== "teacher") {
    return (
      <div className="app-content account-page">
        <Card>
          <Paragraph>Кабинет учителя доступен только учителям.</Paragraph>
          <Link to="/account">
            <Button type="primary">Личный кабинет</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const classesTab = (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card size="small" title="Быстрые действия">
        <Space wrap>
          <Button type="primary" onClick={() => setSchoolModalOpen(true)}>
            Новая школа / организация
          </Button>
          <Button
            type="default"
            onClick={() => setClassModalOpen(true)}
            disabled={!dashboard?.schools.length}
          >
            Новый класс
          </Button>
        </Space>
        {!dashboard?.schools.length ? (
          <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            Сначала создайте школу (кружок, класс в школе, центр и т.д.) — к ней будут привязаны классы.
          </Paragraph>
        ) : null}
      </Card>

      {loading ? (
        <Text type="secondary">Загрузка…</Text>
      ) : !dashboard?.classrooms.length ? (
        <Empty description="Пока нет классов. Создайте класс и дайте ученикам код из карточки класса." />
      ) : (
        dashboard.classrooms.map((c) => (
          <Card
            key={c.id}
            title={
              <Space wrap>
                <TeamOutlined />
                <span>{c.title}</span>
                <Text type="secondary">({c.schoolName})</Text>
              </Space>
            }
            extra={
              <Space>
                <Text type="secondary">Код для входа учеников:</Text>
                <Tag style={{ fontFamily: "monospace", fontSize: 14 }} color="blue">
                  {c.code}
                </Tag>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copyCode(c.code)}>
                  Копировать
                </Button>
              </Space>
            }
          >
            <Paragraph type="secondary" style={{ marginTop: 0 }}>
              Ученик в личном кабинете (режим «ученик школы») вводит этот код в поле «Код класса».
            </Paragraph>
            <Table<DashboardStudent>
              size="small"
              rowKey="enrollmentId"
              columns={studentColumns}
              dataSource={c.students}
              pagination={false}
              locale={{ emptyText: "В классе пока никого нет" }}
            />
          </Card>
        ))
      )}
    </Space>
  );

  const assignmentsTab = (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card size="small" title="Класс">
        <Select
          style={{ minWidth: 280 }}
          placeholder="Выберите класс"
          value={lmsClassroomId || undefined}
          onChange={(v) => setLmsClassroomId(v)}
          options={dashboard?.classrooms.map((c) => ({ value: c.id, label: `${c.title} (${c.schoolName})` })) ?? []}
        />
      </Card>
      {!lmsClassroomId ? (
        <Paragraph type="secondary">Сначала создайте класс на вкладке «Классы и ученики».</Paragraph>
      ) : (
        <>
          <Card
            title="Задания"
            extra={
              <Button type="primary" onClick={openCreateModal}>
                Новое задание
              </Button>
            }
          >
            <Table<TeacherAssignmentRow>
              size="small"
              rowKey="id"
              loading={assignmentsLoading}
              columns={assignmentColumns}
              dataSource={assignments}
              pagination={false}
              locale={{ emptyText: "Пока нет заданий" }}
            />
          </Card>
          <Card title="Сдачи">
            <Space style={{ marginBottom: 12 }} wrap>
              <Text type="secondary">Фильтр по заданию:</Text>
              <Select
                allowClear
                placeholder="Все"
                style={{ minWidth: 220 }}
                value={filterAssignmentId}
                onChange={(v) => setFilterAssignmentId(v)}
                options={assignments.map((a) => ({ value: a.id, label: a.title }))}
              />
            </Space>
            <Table<TeacherSubmissionRow>
              size="small"
              rowKey="id"
              loading={submissionsLoading}
              columns={submissionColumns}
              dataSource={submissions}
              pagination={{ pageSize: 12 }}
            />
          </Card>
        </>
      )}
    </Space>
  );

  const gradebookTab = (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card size="small" title="Класс">
        <Space wrap>
          <Select
            style={{ minWidth: 280 }}
            placeholder="Выберите класс"
            value={lmsClassroomId || undefined}
            onChange={(v) => {
              setLmsClassroomId(v);
              void loadGradebook(v);
            }}
            options={dashboard?.classrooms.map((c) => ({ value: c.id, label: `${c.title} (${c.schoolName})` })) ?? []}
          />
          <Button
            type="default"
            disabled={!lmsClassroomId}
            onClick={() => void loadGradebook(lmsClassroomId)}
          >
            Обновить журнал
          </Button>
        </Space>
      </Card>
      {lmsClassroomId ? (
        <Table<{ id: string; nickname: string }>
          size="small"
          rowKey="id"
          loading={gradebookLoading}
          scroll={{ x: Math.max(400, (gradebook?.assignments.length ?? 0) * 100 + 140) }}
          columns={gradebookColumns}
          dataSource={gradebook?.students ?? []}
          pagination={false}
          locale={{ emptyText: "Нет данных — нажми «Обновить журнал»" }}
        />
      ) : (
        <Paragraph type="secondary">Выбери класс и обнови журнал.</Paragraph>
      )}
    </Space>
  );

  const adminTab =
    user.isAdmin === true ? (
      <Card title="Новый шаблон урока (каталог)">
        <Paragraph type="secondary">
          Снапшот — JSON Blockly-проекта (как в API проектов). Ученики увидят урок в «Обучении»; учитель может
          привязать шаблон к заданию.
        </Paragraph>
        <Form layout="vertical" onFinish={(v) => void submitAdminTemplate(v)} style={{ maxWidth: 560 }}>
          <Form.Item name="title" label="Название" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="moduleKey" label="Ключ модуля" initialValue="module_a" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sortOrder" label="Порядок" initialValue={0}>
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input />
          </Form.Item>
          <Form.Item name="published" label="Опубликован" valuePropName="checked" initialValue>
            <Switch />
          </Form.Item>
          <Form.Item label="starterPayload (JSON)">
            <TextArea rows={12} value={adminStarterJson} onChange={(e) => setAdminStarterJson(e.target.value)} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={adminSubmitting}>
            Создать шаблон
          </Button>
        </Form>
      </Card>
    ) : (
      <Card>
        <Paragraph>Раздел только для администраторов.</Paragraph>
      </Card>
    );

  const roadmapTab = (
    <Card>
      <Title level={5}>Куда развивается кабинет учителя</Title>
      <Paragraph>
        По продуктовой концепции Nodly здесь со временем появятся модули для школ и кружков: не только список
        классов, но и полноценная работа с группой.
      </Paragraph>
      <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
        <li>
          <Text strong>Успеваемость и журнал</Text> — таблица «ученики × задания» на вкладке «Журнал».
        </li>
        <li>
          <Text strong>Задания</Text> — выдача ДЗ и классных работ, дедлайны, проверка проектов Blockly.
        </li>
        <li>
          <Text strong>Готовая программа</Text> — шаблоны уроков в каталоге и при создании задания.
        </li>
      </ul>
    </Card>
  );

  const tabItems = [
    {
      key: "classes",
      label: (
        <Badge count={tabBadges.newEnroll} size="small" offset={[10, 0]}>
          <span>Классы и ученики</span>
        </Badge>
      ),
      children: classesTab
    },
    {
      key: "assignments",
      label: (
        <Badge count={tabBadges.pending} size="small" offset={[10, 0]}>
          <span>Задания и проверка</span>
        </Badge>
      ),
      children: assignmentsTab
    },
    { key: "gradebook", label: "Журнал", children: gradebookTab },
    { key: "roadmap", label: "Планы развития", children: roadmapTab }
  ];
  if (user.isAdmin === true) {
    tabItems.splice(3, 0, { key: "admin", label: "Админ: шаблоны", children: adminTab });
  }

  return (
    <div className="app-content account-page">
      {contextHolder}
      <Space direction="vertical" size="large" style={{ width: "100%", maxWidth: 960 }}>
        <Title level={4} style={{ margin: 0 }}>
          Кабинет учителя
        </Title>
        <Tabs
          activeKey={activeTab}
          items={tabItems}
          onChange={handleTeacherTabChange}
          onTabClick={(key) => handleTeacherTabClick(key)}
        />
      </Space>

      <Modal
        title="Новая школа / организация"
        open={schoolModalOpen}
        okText="Создать"
        onCancel={() => {
          setSchoolModalOpen(false);
          setSchoolName("");
        }}
        onOk={() => void handleCreateSchool()}
      >
        <Paragraph type="secondary">
          Название: школа, филиал, кружок — как вам удобно вести учёт.
        </Paragraph>
        <Input
          placeholder="Например: Гимназия №5, кружок «Nodly»"
          value={schoolName}
          onChange={(e) => setSchoolName(e.target.value)}
        />
      </Modal>

      <Modal
        title="Новый класс"
        open={classModalOpen}
        okText="Создать"
        onCancel={() => {
          setClassModalOpen(false);
          setClassTitle("");
        }}
        onOk={() => void handleCreateClass()}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div>
            <Text type="secondary">Школа</Text>
            <Select
              style={{ width: "100%", marginTop: 4 }}
              value={classSchoolId || undefined}
              placeholder="Выберите школу"
              options={dashboard?.schools.map((s) => ({ value: s.id, label: s.name })) ?? []}
              onChange={(v) => setClassSchoolId(v)}
            />
          </div>
          <div>
            <Text type="secondary">Название класса</Text>
            <Input
              style={{ marginTop: 4 }}
              placeholder="Например: 7Б информатика, группа суббота"
              value={classTitle}
              onChange={(e) => setClassTitle(e.target.value)}
            />
          </div>
        </Space>
      </Modal>

      <Modal title="Новое задание" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void submitCreate()}>
        <Form form={createForm} layout="vertical">
          <Form.Item name="title" label="Название" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="kind" label="Тип" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "homework", label: "Домашнее" },
                { value: "classwork", label: "На уроке" },
                { value: "project", label: "Проект" }
              ]}
            />
          </Form.Item>
          <Form.Item name="maxScore" label="Макс. балл" rules={[{ required: true }]}>
            <InputNumber min={1} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="dueAt" label="Срок (необязательно)">
            <DatePicker style={{ width: "100%" }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="lessonTemplateId" label="Шаблон урока (необязательно)">
            <Select
              allowClear
              placeholder="Пустой проект или из каталога"
              options={templates.map((t) => ({ value: t.id, label: t.title }))}
            />
          </Form.Item>
          <Form.Item name="published" label="Видно ученикам" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Задание" open={editOpen} onCancel={() => setEditOpen(false)} onOk={() => void submitEdit()}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="Название" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="kind" label="Тип" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "homework", label: "Домашнее" },
                { value: "classwork", label: "На уроке" },
                { value: "project", label: "Проект" }
              ]}
            />
          </Form.Item>
          <Form.Item name="maxScore" label="Макс. балл" rules={[{ required: true }]}>
            <InputNumber min={1} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="dueAt" label="Срок">
            <DatePicker style={{ width: "100%" }} format="DD.MM.YYYY" allowClear />
          </Form.Item>
          <Form.Item name="published" label="Видно ученикам" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Проверка сдачи"
        open={gradeOpen}
        onCancel={() => {
          setGradeOpen(false);
          setGradingSubmission(null);
        }}
        onOk={() => void submitGrade()}
        width={520}
      >
        {gradingSubmission ? (
          <Form form={gradeForm} layout="vertical">
            <Paragraph>
              {gradingSubmission.student.nickname} — {gradingSubmission.assignment.title}
            </Paragraph>
            <Form.Item name="decision" label="Решение">
              <Select
                options={[
                  { value: "grade", label: "Поставить оценку" },
                  { value: "revision", label: "Вернуть на доработку" }
                ]}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(p, c) => p.decision !== c.decision}>
              {({ getFieldValue }) =>
                getFieldValue("decision") === "grade" ? (
                  <Form.Item
                    name="score"
                    label="Балл"
                    rules={[{ required: true }]}
                    extra={`0…${gradingSubmission.assignment.maxScore}`}
                  >
                    <InputNumber min={0} max={gradingSubmission.assignment.maxScore} style={{ width: "100%" }} />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
            <Form.Item name="comment" label="Комментарий для ученика">
              <TextArea rows={3} placeholder="Необязательно при оценке, желательно при доработке" />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}
