import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  DatePicker,
  TimePicker,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link, useLocation } from "react-router-dom";
import { CheckOutlined, CopyOutlined, TeamOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import { passedLessonTemplateIdsFromSlots } from "@/shared/scheduleSlotPast";
import { WeekScheduleCalendar } from "@/app/WeekScheduleCalendar";
import { EMPTY_LESSON_CONTENT, type LessonContent } from "@/shared/types/lessonContent";

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
  courseModule: string;
  courseHours: number;
  createdAt: string;
  students: DashboardStudent[];
}

interface TeacherCourseLesson {
  id: string;
  title: string;
  description: string | null;
  moduleKey: string;
  sortOrder: number;
  teacherGuideMd: string | null;
  studentSummary: string | null;
  lessonContent?: LessonContent | null;
}

interface TeacherCourseResponse {
  courseModule: string;
  courseHours: number;
  lessons: TeacherCourseLesson[];
}

interface ScheduleSlotRow {
  id: string;
  startsAt: string;
  endsAt: string | null;
  durationMinutes: number;
  notes: string | null;
  lessonTemplateId: string | null;
  lessonTitle: string | null;
  weeklySeriesId: string | null;
  linkedAssignments?: { id: string; title: string; kind: string; dueAt: string | null }[];
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
  assignment: { id: string; title: string; maxScore: number; kind: string };
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
  classwork: "Классная работа",
  homework: "ДЗ"
};

const COMMON_START_TIMES = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00"
] as const;

function disabledTimeForSelectedDate(selectedDate: dayjs.Dayjs | null) {
  if (!selectedDate || !selectedDate.isSame(dayjs(), "day")) {
    return {};
  }
  const now = dayjs();
  const hour = now.hour();
  const minute = now.minute();
  return {
    disabledHours: () => Array.from({ length: hour }, (_, i) => i),
    disabledMinutes: (selectedHour: number) => {
      if (selectedHour !== hour) {
        return [];
      }
      return Array.from({ length: minute + 1 }, (_, i) => i);
    }
  };
}

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
  const [classCourseModule, setClassCourseModule] = useState<"A" | "B" | "C" | "D">("A");
  const [deleteClassTarget, setDeleteClassTarget] = useState<DashboardClassroom | null>(null);
  const [deleteClassConfirmTitle, setDeleteClassConfirmTitle] = useState("");

  const [lmsClassroomId, setLmsClassroomId] = useState<string>("");
  const [lmsInnerTab, setLmsInnerTab] = useState("assignments");
  const [courseBundle, setCourseBundle] = useState<TeacherCourseResponse | null>(null);
  const [courseScheduleLoading, setCourseScheduleLoading] = useState(false);
  const [scheduleSlots, setScheduleSlots] = useState<ScheduleSlotRow[]>([]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideTitle, setGuideTitle] = useState("");
  const [guideMd, setGuideMd] = useState("");
  const [lessonEditorOpen, setLessonEditorOpen] = useState(false);
  const [lessonEditorSaving, setLessonEditorSaving] = useState(false);
  const [lessonEditorLesson, setLessonEditorLesson] = useState<TeacherCourseLesson | null>(null);
  const [lessonEditorSummary, setLessonEditorSummary] = useState("");
  const [lessonEditorJson, setLessonEditorJson] = useState(
    JSON.stringify(EMPTY_LESSON_CONTENT, null, 2)
  );
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [newSlotLessonId, setNewSlotLessonId] = useState<string | undefined>(undefined);
  const [newSlotDate, setNewSlotDate] = useState<dayjs.Dayjs | null>(null);
  const [newSlotTime, setNewSlotTime] = useState<dayjs.Dayjs | null>(null);
  const [newSlotDurationMinutes, setNewSlotDurationMinutes] = useState<number>(90);
  const [newSlotRepeatWeekly, setNewSlotRepeatWeekly] = useState(false);
  const [newSlotRepeatWeeks, setNewSlotRepeatWeeks] = useState(12);
  const [newSlotAttachClasswork, setNewSlotAttachClasswork] = useState(true);
  const [newSlotAddHomework, setNewSlotAddHomework] = useState(false);
  const [newSlotHomeworkDue, setNewSlotHomeworkDue] = useState<dayjs.Dayjs | null>(null);
  const [newSlotHomeworkDaysAfter, setNewSlotHomeworkDaysAfter] = useState(7);
  const [newSlotClassworkTitle, setNewSlotClassworkTitle] = useState("");
  const [newSlotHomeworkTitle, setNewSlotHomeworkTitle] = useState("");
  const [newSlotClassworkDesc, setNewSlotClassworkDesc] = useState("");
  const [newSlotHomeworkDesc, setNewSlotHomeworkDesc] = useState("");
  const [newSlotNotes, setNewSlotNotes] = useState("");
  const [scheduleWeekAnchor, setScheduleWeekAnchor] = useState(() => dayjs());
  const [addingSlot, setAddingSlot] = useState(false);
  const [editSlotModalOpen, setEditSlotModalOpen] = useState(false);
  const [editSlotSaving, setEditSlotSaving] = useState(false);
  const [editSlotId, setEditSlotId] = useState<string | null>(null);
  const [editSlotDate, setEditSlotDate] = useState<dayjs.Dayjs | null>(null);
  const [editSlotTimeStart, setEditSlotTimeStart] = useState<dayjs.Dayjs | null>(null);
  const [editSlotTimeEnd, setEditSlotTimeEnd] = useState<dayjs.Dayjs | null>(null);
  const [editSlotLessonId, setEditSlotLessonId] = useState<string | undefined>(undefined);
  const [editSlotNotes, setEditSlotNotes] = useState("");
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

  useEffect(() => {
    if (!lmsClassroomId) {
      setCourseBundle(null);
      setScheduleSlots([]);
      return;
    }
    let cancelled = false;
    setCourseScheduleLoading(true);
    void (async () => {
      try {
        const [c, s] = await Promise.all([
          apiClient.get<TeacherCourseResponse>(`/api/teacher/classrooms/${lmsClassroomId}/course`),
          apiClient.get<ScheduleSlotRow[]>(`/api/teacher/classrooms/${lmsClassroomId}/schedule`)
        ]);
        if (!cancelled) {
          setCourseBundle(c);
          setScheduleSlots(s);
        }
      } catch {
        if (!cancelled) {
          setCourseBundle(null);
          setScheduleSlots([]);
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
  }, [lmsClassroomId]);

  const passedLessonTemplateIds = useMemo(
    () => passedLessonTemplateIdsFromSlots(scheduleSlots),
    [scheduleSlots]
  );

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
      await apiClient.post("/api/classrooms", {
        schoolId: classSchoolId,
        title: titleTrim,
        courseModule: classCourseModule
      });
      messageApi.success("Класс создан, код для учеников сгенерирован");
      setClassModalOpen(false);
      setClassTitle("");
      setClassCourseModule("A");
      await loadDashboard();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const handleRemoveStudent = async (classroomId: string, enrollmentId: string) => {
    try {
      await apiClient.delete(`/api/teacher/classrooms/${classroomId}/enrollments/${enrollmentId}`);
      messageApi.success("Ученик исключён из класса");
      await loadDashboard();
      if (lmsClassroomId === classroomId) {
        void loadSubmissions(lmsClassroomId, filterAssignmentId);
        void loadAssignments(lmsClassroomId);
        void loadGradebook(lmsClassroomId);
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const handleDeleteClassroomSubmit = async () => {
    if (!deleteClassTarget) {
      return;
    }
    if (deleteClassConfirmTitle.trim() !== deleteClassTarget.title.trim()) {
      messageApi.error("Введите название класса точно, как в карточке");
      return;
    }
    const id = deleteClassTarget.id;
    try {
      await apiClient.delete(`/api/teacher/classrooms/${id}`);
      messageApi.success("Класс удалён");
      setDeleteClassTarget(null);
      setDeleteClassConfirmTitle("");
      if (lmsClassroomId === id) {
        setLmsClassroomId("");
      }
      await loadDashboard();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const reloadSchedule = async () => {
    if (!lmsClassroomId) {
      return;
    }
    try {
      const s = await apiClient.get<ScheduleSlotRow[]>(`/api/teacher/classrooms/${lmsClassroomId}/schedule`);
      setScheduleSlots(s);
    } catch {
      setScheduleSlots([]);
    }
  };

  const submitNewScheduleSlot = async () => {
    if (!lmsClassroomId || !newSlotDate || !newSlotTime) {
      messageApi.error("Укажи дату и время начала");
      return;
    }
    if (newSlotDurationMinutes < 5 || newSlotDurationMinutes > 720) {
      messageApi.error("Длительность: от 5 до 720 минут");
      return;
    }
    const repeatWeeks = newSlotRepeatWeekly ? newSlotRepeatWeeks : 1;
    if (newSlotRepeatWeekly && repeatWeeks < 2) {
      messageApi.error("При повторе укажи не меньше 2 занятий");
      return;
    }
    if (newSlotAddHomework && !newSlotRepeatWeekly) {
      if (!newSlotHomeworkDue) {
        messageApi.error("Укажи срок сдачи домашнего задания");
        return;
      }
      if (newSlotHomeworkDue.endOf("day").isBefore(dayjs())) {
        messageApi.error("Срок сдачи не может быть в прошлом");
        return;
      }
    }
    const start = newSlotDate.hour(newSlotTime.hour()).minute(newSlotTime.minute()).second(0).millisecond(0);
    if (start.isBefore(dayjs())) {
      messageApi.error("Нельзя ставить занятие в прошедшее время");
      return;
    }
    setAddingSlot(true);
    try {
      await apiClient.post(`/api/teacher/classrooms/${lmsClassroomId}/schedule`, {
        startsAt: start.toISOString(),
        durationMinutes: newSlotDurationMinutes,
        lessonTemplateId: newSlotLessonId ?? null,
        notes: newSlotNotes.trim() || null,
        repeatWeeks,
        attachClasswork: newSlotAttachClasswork,
        addHomework: newSlotAddHomework,
        homeworkDueAt:
          newSlotAddHomework && !newSlotRepeatWeekly && newSlotHomeworkDue
            ? newSlotHomeworkDue.endOf("day").toISOString()
            : null,
        homeworkDueDaysAfterLesson:
          newSlotAddHomework && newSlotRepeatWeekly ? newSlotHomeworkDaysAfter : undefined,
        classworkTitle: newSlotClassworkTitle.trim() || null,
        homeworkTitle: newSlotHomeworkTitle.trim() || null,
        classworkDescription: newSlotClassworkDesc.trim() || null,
        homeworkDescription: newSlotHomeworkDesc.trim() || null
      });
      messageApi.success(repeatWeeks > 1 ? `Добавлено занятий: ${repeatWeeks}` : "Занятие добавлено");
      setScheduleModalOpen(false);
      setNewSlotLessonId(undefined);
      setNewSlotNotes("");
      setNewSlotRepeatWeekly(false);
      setNewSlotRepeatWeeks(12);
      setNewSlotAttachClasswork(true);
      setNewSlotAddHomework(false);
      setNewSlotHomeworkDue(null);
      setNewSlotHomeworkDaysAfter(7);
      setNewSlotClassworkTitle("");
      setNewSlotHomeworkTitle("");
      setNewSlotClassworkDesc("");
      setNewSlotHomeworkDesc("");
      setScheduleWeekAnchor(start);
      await reloadSchedule();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setAddingSlot(false);
    }
  };

  const openEditScheduleSlot = (slotId: string) => {
    const row = scheduleSlots.find((s) => s.id === slotId);
    if (!row) {
      return;
    }
    const start = dayjs(row.startsAt);
    const end = row.endsAt ? dayjs(row.endsAt) : start.add(row.durationMinutes, "minute");
    setEditSlotId(slotId);
    setEditSlotDate(start);
    setEditSlotTimeStart(start);
    setEditSlotTimeEnd(end);
    setEditSlotLessonId(row.lessonTemplateId ?? undefined);
    setEditSlotNotes(row.notes ?? "");
    setEditSlotModalOpen(true);
  };

  const submitEditScheduleSlot = async () => {
    if (!editSlotId || !editSlotDate || !editSlotTimeStart || !editSlotTimeEnd) {
      messageApi.error("Укажите дату, время начала и окончания");
      return;
    }
    const start = editSlotDate
      .hour(editSlotTimeStart.hour())
      .minute(editSlotTimeStart.minute())
      .second(0)
      .millisecond(0);
    let end = editSlotDate
      .hour(editSlotTimeEnd.hour())
      .minute(editSlotTimeEnd.minute())
      .second(0)
      .millisecond(0);
    if (!end.isAfter(start)) {
      end = end.add(1, "day");
    }
    if (!end.isAfter(start) || end.diff(start, "minute") < 5) {
      messageApi.error("Занятие должно длиться не меньше 5 минут, окончание позже начала");
      return;
    }
    if (start.isBefore(dayjs())) {
      messageApi.error("Нельзя ставить занятие в прошедшее время");
      return;
    }
    setEditSlotSaving(true);
    try {
      await apiClient.patch(`/api/teacher/schedule-slots/${editSlotId}`, {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        lessonTemplateId: editSlotLessonId ?? null,
        notes: editSlotNotes.trim() ? editSlotNotes.trim() : null
      });
      messageApi.success("Занятие обновлено");
      setEditSlotModalOpen(false);
      setEditSlotId(null);
      await reloadSchedule();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setEditSlotSaving(false);
    }
  };

  const deleteScheduleSlot = async (slotId: string) => {
    try {
      await apiClient.delete(`/api/teacher/schedule-slots/${slotId}`);
      messageApi.success("Удалено");
      await reloadSchedule();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const deleteScheduleSeries = async (seriesId: string) => {
    try {
      await apiClient.delete(`/api/teacher/schedule-series/${encodeURIComponent(seriesId)}`);
      messageApi.success("Серия занятий удалена");
      await reloadSchedule();
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

  const openLessonEditor = (lesson: TeacherCourseLesson) => {
    setLessonEditorLesson(lesson);
    setLessonEditorSummary(lesson.studentSummary ?? "");
    setLessonEditorJson(JSON.stringify(lesson.lessonContent ?? EMPTY_LESSON_CONTENT, null, 2));
    setLessonEditorOpen(true);
  };

  const submitLessonEditor = async () => {
    if (!lessonEditorLesson) {
      return;
    }
    let lessonContent: LessonContent;
    try {
      lessonContent = JSON.parse(lessonEditorJson) as LessonContent;
    } catch {
      messageApi.error("Некорректный JSON материалов урока");
      return;
    }
    setLessonEditorSaving(true);
    try {
      await apiClient.patch(`/api/admin/lesson-templates/${lessonEditorLesson.id}/content`, {
        studentSummary: lessonEditorSummary.trim() || null,
        lessonContent
      });
      messageApi.success("Материалы урока сохранены");
      setLessonEditorOpen(false);
      if (lmsClassroomId) {
        const c = await apiClient.get<TeacherCourseResponse>(`/api/teacher/classrooms/${lmsClassroomId}/course`);
        setCourseBundle(c);
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось сохранить материалы");
    } finally {
      setLessonEditorSaving(false);
    }
  };

  const getStudentColumns = (classroomId: string): ColumnsType<DashboardStudent> => [
    { title: "Ник", dataIndex: "nickname", key: "nickname" },
    { title: "Email", dataIndex: "email", key: "email" },
    {
      title: "В классе с",
      dataIndex: "joinedAt",
      key: "joinedAt",
      render: (v: string) => new Date(v).toLocaleString("ru-RU")
    },
    {
      title: "",
      key: "remove",
      width: 120,
      render: (_, row) => (
        <Popconfirm
          title="Исключить ученика из класса?"
          description="Сдачи по заданиям этого класса будут удалены."
          onConfirm={() => void handleRemoveStudent(classroomId, row.enrollmentId)}
          okText="Исключить"
          cancelText="Отмена"
        >
          <Button danger type="link" size="small">
            Исключить
          </Button>
        </Popconfirm>
      )
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
      title: "Тип",
      key: "kind",
      width: 110,
      render: (_, r) => KIND_RU[r.assignment.kind] ?? r.assignment.kind
    },
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
          {r.status === "submitted" ||
          r.status === "needs_revision" ||
          r.status === "draft" ||
          (r.status === "not_started" && r.assignment.kind === "classwork") ? (
            <Button type="link" size="small" onClick={() => openGrade(r)}>
              {r.status === "not_started" ? "Оценить работу" : "Оценить"}
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

  if (user.role !== "teacher" && user.role !== "admin") {
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
              <Space wrap>
                <Tag color="geekblue">
                  Модуль {c.courseModule} · {c.courseHours} ч.
                </Tag>
                <Text type="secondary">Код:</Text>
                <Tag style={{ fontFamily: "monospace", fontSize: 14 }} color="blue">
                  {c.code}
                </Tag>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copyCode(c.code)}>
                  Копировать
                </Button>
                <Button size="small" danger onClick={() => setDeleteClassTarget(c)}>
                  Удалить класс
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
              columns={getStudentColumns(c.id)}
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
        <Tabs
          activeKey={lmsInnerTab}
          onChange={setLmsInnerTab}
          items={[
            {
              key: "assignments",
              label: "Задания и сдачи",
              children: (
                <Space direction="vertical" size="large" style={{ width: "100%" }}>
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
                </Space>
              )
            },
            {
              key: "course",
              label: "Курс и методички",
              children: (
                <Spin spinning={courseScheduleLoading}>
                  <Paragraph type="secondary" style={{ marginTop: 0 }}>
                    Модуль {courseBundle?.courseModule ?? "—"} · {courseBundle?.courseHours ?? "—"} акад. часов
                    (план).
                  </Paragraph>
                  <Table<TeacherCourseLesson>
                    size="small"
                    rowKey="id"
                    dataSource={courseBundle?.lessons ?? []}
                    pagination={false}
                    locale={{ emptyText: "Нет уроков для этого модуля" }}
                    columns={[
                      {
                        title: "",
                        key: "passed",
                        width: 40,
                        align: "center",
                        render: (_, row: TeacherCourseLesson) =>
                          passedLessonTemplateIds.has(row.id) ? (
                            <CheckOutlined style={{ color: "var(--ant-color-success)" }} aria-label="Урок проведён" />
                          ) : null
                      },
                      { title: "№", width: 48, render: (_, __, i) => i + 1 },
                      { title: "Урок", dataIndex: "title", key: "title" },
                      {
                        title: "Кратко (для ученика)",
                        dataIndex: "studentSummary",
                        key: "sum",
                        ellipsis: true,
                        render: (t: string | null) => t ?? "—"
                      },
                      {
                        title: "",
                        key: "guide",
                        width: 260,
                        render: (_, row) => (
                          <Space size="small" wrap>
                            <Button
                              size="small"
                              onClick={() => {
                                setGuideTitle(row.title);
                                setGuideMd(row.teacherGuideMd ?? "Методичка пока не заполнена.");
                                setGuideOpen(true);
                              }}
                            >
                              Методичка
                            </Button>
                            {user.role === "admin" ? (
                              <Button size="small" onClick={() => openLessonEditor(row)}>
                                Материалы (админ)
                              </Button>
                            ) : null}
                          </Space>
                        )
                      }
                    ]}
                  />
                </Spin>
              )
            },
          ]}
        />
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
    user.role === "admin" ? (
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

  const scheduleCabinetTab = (
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
        <Spin spinning={courseScheduleLoading}>
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Button
              type="primary"
              onClick={() => {
                setNewSlotDate(dayjs());
                setNewSlotTime(dayjs().hour(9).minute(0).second(0));
                setNewSlotDurationMinutes(90);
                setNewSlotRepeatWeekly(false);
                setNewSlotRepeatWeeks(12);
                setNewSlotAttachClasswork(true);
                setNewSlotAddHomework(false);
                setNewSlotHomeworkDue(null);
                setNewSlotHomeworkDaysAfter(7);
                setNewSlotClassworkTitle("");
                setNewSlotHomeworkTitle("");
                setNewSlotClassworkDesc("");
                setNewSlotHomeworkDesc("");
                setNewSlotLessonId(undefined);
                setNewSlotNotes("");
                setScheduleModalOpen(true);
              }}
            >
              Добавить занятие
            </Button>
            <WeekScheduleCalendar
              weekAnchor={scheduleWeekAnchor}
              onPrevWeek={() => setScheduleWeekAnchor((w) => w.subtract(1, "week"))}
              onNextWeek={() => setScheduleWeekAnchor((w) => w.add(1, "week"))}
              onThisWeek={() => setScheduleWeekAnchor(dayjs())}
              slots={scheduleSlots.map((s) => ({
                id: s.id,
                startsAt: s.startsAt,
                endsAt: s.endsAt,
                durationMinutes: s.durationMinutes,
                lessonTemplateId: s.lessonTemplateId,
                lessonTitle: s.lessonTitle,
                notes: s.notes,
                weeklySeriesId: s.weeklySeriesId,
                linkedAssignments: s.linkedAssignments ?? []
              }))}
              variant="teacher"
              onEditSlot={(id) => openEditScheduleSlot(id)}
              onDeleteSlot={(id) => void deleteScheduleSlot(id)}
              onDeleteSeries={(sid) => void deleteScheduleSeries(sid)}
            />
          </Space>
        </Spin>
      )}
    </Space>
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
    { key: "schedule", label: "Расписание", children: scheduleCabinetTab },
    { key: "gradebook", label: "Журнал", children: gradebookTab },
    { key: "roadmap", label: "Планы развития", children: roadmapTab }
  ];
  if (user.role === "admin") {
    tabItems.splice(3, 0, { key: "admin", label: "Админ: шаблоны", children: adminTab });
  }
  if (user.role === "admin") {
    tabItems.splice(0, tabItems.length, { key: "admin", label: "Админ: шаблоны", children: adminTab });
  }

  return (
    <div className="app-content account-page lms-shell-wide">
      {contextHolder}
      <Space direction="vertical" size="large" style={{ width: "100%", maxWidth: "none" }}>
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
          setClassCourseModule("A");
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
          <div>
            <Text type="secondary">Модуль курса (объём в часах)</Text>
            <Select
              style={{ width: "100%", marginTop: 4 }}
              value={classCourseModule}
              onChange={(v) => setClassCourseModule(v)}
              options={[
                { value: "A", label: "A — 8 ч." },
                { value: "B", label: "B — 24 ч. (скоро)", disabled: true },
                { value: "C", label: "C — 48 ч. (скоро)", disabled: true },
                { value: "D", label: "D — 72 ч. (скоро)", disabled: true }
              ]}
            />
          </div>
        </Space>
      </Modal>

      <Modal
        title="Удалить класс"
        open={Boolean(deleteClassTarget)}
        onCancel={() => {
          setDeleteClassTarget(null);
          setDeleteClassConfirmTitle("");
        }}
        footer={null}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Paragraph>
            Будут удалены задания, сдачи, расписание и приглашения. Введите название класса{" "}
            <Text strong>{deleteClassTarget?.title}</Text> для подтверждения.
          </Paragraph>
          <Input
            placeholder="Название класса"
            value={deleteClassConfirmTitle}
            onChange={(e) => setDeleteClassConfirmTitle(e.target.value)}
          />
          <Button type="primary" danger onClick={() => void handleDeleteClassroomSubmit()}>
            Удалить класс навсегда
          </Button>
        </Space>
      </Modal>

      <Modal
        title="Занятие в расписании"
        open={scheduleModalOpen}
        okText="Добавить"
        confirmLoading={addingSlot}
        onCancel={() => setScheduleModalOpen(false)}
        onOk={() => void submitNewScheduleSlot()}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div>
            <Text type="secondary">Дата</Text>
            <DatePicker
              style={{ width: "100%", marginTop: 4 }}
              value={newSlotDate}
              onChange={(d) => {
                setNewSlotDate(d);
                if (d && newSlotTime) {
                  const nextStart = d
                    .hour(newSlotTime.hour())
                    .minute(newSlotTime.minute())
                    .second(0)
                    .millisecond(0);
                  if (nextStart.isBefore(dayjs())) {
                    setNewSlotTime(dayjs().add(15, "minute").second(0).millisecond(0));
                  }
                }
              }}
              format="DD.MM.YYYY"
              disabledDate={(current) => current != null && current < dayjs().startOf("day")}
            />
          </div>
          <div>
            <Text type="secondary">Время начала</Text>
            <TimePicker
              style={{ width: "100%", marginTop: 4 }}
              value={newSlotTime}
              onChange={(d) => setNewSlotTime(d)}
              format="HH:mm"
              minuteStep={5}
              needConfirm={false}
              disabledTime={(date) => disabledTimeForSelectedDate(newSlotDate ?? date)}
            />
            <Space wrap size={6} style={{ marginTop: 8 }}>
              {COMMON_START_TIMES.map((t) => (
                <Button
                  key={t}
                  size="small"
                  type={newSlotTime?.format("HH:mm") === t ? "primary" : "default"}
                  onClick={() => {
                    const [h, m] = t.split(":").map(Number);
                    const candidate = dayjs().hour(h).minute(m).second(0).millisecond(0);
                    if (newSlotDate && newSlotDate.isSame(dayjs(), "day") && candidate.isBefore(dayjs())) {
                      return;
                    }
                    setNewSlotTime(candidate);
                  }}
                >
                  {t}
                </Button>
              ))}
            </Space>
          </div>
          <div>
            <Text type="secondary">Длительность (минуты)</Text>
            <InputNumber
              style={{ width: "100%", marginTop: 4 }}
              min={5}
              max={720}
              value={newSlotDurationMinutes}
              onChange={(v) => setNewSlotDurationMinutes(typeof v === "number" ? v : 90)}
            />
          </div>
          <div>
            <Text type="secondary">Повторять каждую неделю</Text>
            <div style={{ marginTop: 6 }}>
              <Switch
                checked={newSlotRepeatWeekly}
                onChange={(v) => {
                  setNewSlotRepeatWeekly(v);
                  if (v) {
                    setNewSlotLessonId(undefined);
                  }
                }}
              />
            </div>
          </div>
          {newSlotRepeatWeekly ? (
            <div>
              <Text type="secondary">Сколько раз (включая первое занятие)</Text>
              <InputNumber
                style={{ width: "100%", marginTop: 4 }}
                min={2}
                max={52}
                value={newSlotRepeatWeeks}
                onChange={(v) => setNewSlotRepeatWeeks(typeof v === "number" ? v : 2)}
              />
            </div>
          ) : null}
          <div>
            <Text type="secondary">Урок из курса (необязательно)</Text>
            <Select
              allowClear
              disabled={newSlotRepeatWeekly}
              style={{ width: "100%", marginTop: 4 }}
              placeholder="Без привязки к уроку"
              value={newSlotLessonId}
              onChange={(v) => setNewSlotLessonId(v)}
              options={courseBundle?.lessons.map((l) => ({ value: l.id, label: l.title })) ?? []}
            />
            {newSlotRepeatWeekly ? (
              <Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
                При серии занятий тема урока в календаре для каждой даты задаётся отдельно: после создания откройте
                нужное занятие и привяжите урок (правка слота в расписании).
              </Paragraph>
            ) : null}
          </div>
          <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
            Для классной работы и ДЗ стартовый проект подставляется из выбранного урока; если урок не выбран — пустой
            шаблон. Для серии без выбора урока — пустой шаблон и свои названия ниже.
          </Paragraph>
          <div>
            <Text type="secondary">Классная работа на этом занятии</Text>
            <div style={{ marginTop: 6 }}>
              <Switch checked={newSlotAttachClasswork} onChange={setNewSlotAttachClasswork} />
            </div>
          </div>
          {newSlotAttachClasswork ? (
            <Space direction="vertical" style={{ width: "100%" }} size="small">
              <Input
                placeholder="Название (необязательно, иначе «Классная работа: …»)"
                value={newSlotClassworkTitle}
                onChange={(e) => setNewSlotClassworkTitle(e.target.value)}
              />
              <TextArea
                rows={2}
                placeholder="Описание для ученика (необязательно)"
                value={newSlotClassworkDesc}
                onChange={(e) => setNewSlotClassworkDesc(e.target.value)}
              />
            </Space>
          ) : null}
          <div>
            <Text type="secondary">ДЗ</Text>
            <div style={{ marginTop: 6 }}>
              <Switch checked={newSlotAddHomework} onChange={setNewSlotAddHomework} />
            </div>
          </div>
          {newSlotAddHomework && !newSlotRepeatWeekly ? (
            <div>
              <Text type="secondary">Срок сдачи</Text>
              <DatePicker
                style={{ width: "100%", marginTop: 4 }}
                value={newSlotHomeworkDue}
                onChange={(d) => setNewSlotHomeworkDue(d)}
                format="DD.MM.YYYY"
                disabledDate={(current) => current != null && current < dayjs().startOf("day")}
              />
            </div>
          ) : null}
          {newSlotAddHomework && newSlotRepeatWeekly ? (
            <div>
              <Text type="secondary">Сдать через дней после занятия (конец календарного дня)</Text>
              <InputNumber
                style={{ width: "100%", marginTop: 4 }}
                min={0}
                max={28}
                value={newSlotHomeworkDaysAfter}
                onChange={(v) => setNewSlotHomeworkDaysAfter(typeof v === "number" ? v : 7)}
              />
            </div>
          ) : null}
          {newSlotAddHomework ? (
            <Space direction="vertical" style={{ width: "100%" }} size="small">
              <Input
                placeholder="Название ДЗ (необязательно, иначе «ДЗ: …»)"
                value={newSlotHomeworkTitle}
                onChange={(e) => setNewSlotHomeworkTitle(e.target.value)}
              />
              <TextArea
                rows={2}
                placeholder="Описание ДЗ (необязательно)"
                value={newSlotHomeworkDesc}
                onChange={(e) => setNewSlotHomeworkDesc(e.target.value)}
              />
            </Space>
          ) : null}
          {newSlotRepeatWeekly && (newSlotAddHomework || newSlotAttachClasswork) ? (
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              При серии занятий письма ученикам о новых заданиях не отправляются. ДЗ для каждой недели получает свой дедлайн по
              правилу «через N дней после урока».
            </Paragraph>
          ) : null}
          <TextArea
            value={newSlotNotes}
            onChange={(e) => setNewSlotNotes(e.target.value)}
            placeholder="Заметка к занятию (аудитория, ссылка…)"
            rows={2}
          />
        </Space>
      </Modal>

      <Modal
        title="Редактировать занятие"
        open={editSlotModalOpen}
        okText="Сохранить"
        confirmLoading={editSlotSaving}
        onCancel={() => {
          setEditSlotModalOpen(false);
          setEditSlotId(null);
        }}
        onOk={() => void submitEditScheduleSlot()}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
            Изменения касаются только этого занятия в календаре (в том числе в еженедельной серии). Привязка урока задаёт
            тему в расписании; задания на слот не переименовываются автоматически.
          </Paragraph>
          <div>
            <Text type="secondary">Дата</Text>
            <DatePicker
              style={{ width: "100%", marginTop: 4 }}
              value={editSlotDate}
              onChange={(d) => {
                setEditSlotDate(d);
                if (d && editSlotTimeStart) {
                  const nextStart = d
                    .hour(editSlotTimeStart.hour())
                    .minute(editSlotTimeStart.minute())
                    .second(0)
                    .millisecond(0);
                  if (nextStart.isBefore(dayjs())) {
                    setEditSlotTimeStart(dayjs().add(15, "minute").second(0).millisecond(0));
                  }
                }
              }}
              format="DD.MM.YYYY"
              disabledDate={(current) => current != null && current < dayjs().startOf("day")}
            />
          </div>
          <div>
            <Text type="secondary">Время начала</Text>
            <TimePicker
              style={{ width: "100%", marginTop: 4 }}
              value={editSlotTimeStart}
              onChange={(d) => setEditSlotTimeStart(d)}
              format="HH:mm"
              minuteStep={5}
              needConfirm={false}
              disabledTime={(date) => disabledTimeForSelectedDate(editSlotDate ?? date)}
            />
            <Space wrap size={6} style={{ marginTop: 8 }}>
              {COMMON_START_TIMES.map((t) => (
                <Button
                  key={`edit-${t}`}
                  size="small"
                  type={editSlotTimeStart?.format("HH:mm") === t ? "primary" : "default"}
                  onClick={() => {
                    const [h, m] = t.split(":").map(Number);
                    const candidate = dayjs().hour(h).minute(m).second(0).millisecond(0);
                    if (editSlotDate && editSlotDate.isSame(dayjs(), "day") && candidate.isBefore(dayjs())) {
                      return;
                    }
                    setEditSlotTimeStart(candidate);
                  }}
                >
                  {t}
                </Button>
              ))}
            </Space>
          </div>
          <div>
            <Text type="secondary">Время окончания</Text>
            <TimePicker
              style={{ width: "100%", marginTop: 4 }}
              value={editSlotTimeEnd}
              onChange={(d) => setEditSlotTimeEnd(d)}
              format="HH:mm"
              minuteStep={5}
              needConfirm={false}
            />
          </div>
          <div>
            <Text type="secondary">Урок программы (тема в расписании)</Text>
            <Select
              allowClear
              style={{ width: "100%", marginTop: 4 }}
              placeholder="Без привязки к уроку"
              value={editSlotLessonId}
              onChange={(v) => setEditSlotLessonId(v)}
              options={courseBundle?.lessons.map((l) => ({ value: l.id, label: l.title })) ?? []}
            />
          </div>
          <TextArea
            value={editSlotNotes}
            onChange={(e) => setEditSlotNotes(e.target.value)}
            placeholder="Заметка к занятию (аудитория, ссылка…)"
            rows={2}
          />
        </Space>
      </Modal>

      <Drawer title={guideTitle} width={560} open={guideOpen} onClose={() => setGuideOpen(false)}>
        <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{guideMd}</Paragraph>
      </Drawer>

      <Modal
        title={lessonEditorLesson ? `Материалы урока: ${lessonEditorLesson.title}` : "Материалы урока"}
        open={lessonEditorOpen}
        width={760}
        okText="Сохранить"
        confirmLoading={lessonEditorSaving}
        onCancel={() => setLessonEditorOpen(false)}
        onOk={() => void submitLessonEditor()}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <div>
            <Text type="secondary">Кратко для ученика</Text>
            <TextArea
              rows={3}
              value={lessonEditorSummary}
              onChange={(e) => setLessonEditorSummary(e.target.value)}
              placeholder="Краткое описание урока в таблице курса"
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <Text type="secondary">lessonContent (JSON)</Text>
            <TextArea
              rows={16}
              value={lessonEditorJson}
              onChange={(e) => setLessonEditorJson(e.target.value)}
              style={{ marginTop: 4, fontFamily: "monospace" }}
            />
            <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              Поддерживаемые поля: presentationPdfUrl, slides[], practiceSteps[], checkpoints[], hints[].
            </Paragraph>
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
                { value: "homework", label: "ДЗ" },
                { value: "classwork", label: "Классная работа" }
              ]}
            />
          </Form.Item>
          <Form.Item name="maxScore" label="Макс. балл" rules={[{ required: true }]}>
            <InputNumber min={1} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="dueAt" label="Срок (необязательно)">
            <DatePicker
              style={{ width: "100%" }}
              format="DD.MM.YYYY"
              disabledDate={(current) => current != null && current < dayjs().startOf("day")}
            />
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
                { value: "homework", label: "ДЗ" },
                { value: "classwork", label: "Классная работа" }
              ]}
            />
          </Form.Item>
          <Form.Item name="maxScore" label="Макс. балл" rules={[{ required: true }]}>
            <InputNumber min={1} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="dueAt" label="Срок">
            <DatePicker
              style={{ width: "100%" }}
              format="DD.MM.YYYY"
              allowClear
              disabledDate={(current) => current != null && current < dayjs().startOf("day")}
            />
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
