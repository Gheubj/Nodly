import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DatabaseOutlined, FormOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Drawer,
  FloatButton,
  Form,
  Input,
  InputNumber,
  Layout,
  List,
  Modal,
  Select,
  Space,
  Tabs,
  Popconfirm,
  Typography,
  message
} from "antd";
import { Link, useSearchParams } from "react-router-dom";
import { BlocklyWorkspace } from "@/features/blockly/BlocklyWorkspace";
import { DataLibrary } from "@/features/data/DataLibrary";
import { StudioSidePanelTabs } from "@/app/StudioSidePanelTabs";
import { StudioSpriteSettingsTab } from "@/app/StudioSpriteSettingsTab";
import { useAppStore } from "@/store/useAppStore";
import type { NodlyProjectMeta, NodlyProjectSnapshot } from "@/shared/types/project";
import type { StudioGoal } from "@/shared/types/lessonContent";
import type { MiniDevTelemetry } from "@/shared/types/lessonPlayerState";
import { evalMiniStudioGoal, summarizeBlocklyState } from "@/shared/miniStudioGoalEval";
import {
  deleteProjectSmart,
  loadProjectSmart,
  loadTeacherReviewMiniProject,
  listProjects,
  saveProjectSmart
} from "@/features/project/projectRepository";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";

const { Content } = Layout;
const { Paragraph, Text } = Typography;
const { TextArea } = Input;

const GUEST_USER_ID_KEY = "nodly_guest_user_id";
const LEGACY_GUEST_USER_ID_KEY = "noda_guest_user_id";
const DEFAULT_PROJECT_TITLE = "Новый проект";
const STUDIO_DRAFT_PREFIX = "nodly_studio_draft_v1";

const EMPTY_SNAPSHOT: NodlyProjectSnapshot = {
  imageDatasets: [],
  tabularDatasets: [],
  imagePredictionInputs: [],
  tabularPredictionInputs: [],
  savedModels: [],
  blocklyState: "",
  workspaceLevel: 1
};

interface SubmissionContext {
  assignmentId: string;
  assignmentTitle: string;
  classroomTitle: string;
  status: string;
  canSubmit: boolean;
  teacherNote: string | null;
  revisionNote: string | null;
  score: number | null;
  autoScore: number | null;
  manualScore: number | null;
  maxScore: number;
}

interface TeacherWorkReview {
  submissionId: string;
  status: string;
  score: number | null;
  autoScore: number | null;
  manualScore: number | null;
  maxScore: number;
  studentNickname: string;
  assignmentTitle: string;
  teacherNote: string | null;
  revisionNote: string | null;
}

interface TeacherWorkPayload {
  meta: NodlyProjectMeta;
  snapshot: NodlyProjectSnapshot;
  review: TeacherWorkReview;
}

function studioDraftStorageKey(userId: string, projectId: string | null): string {
  return `${STUDIO_DRAFT_PREFIX}:${userId}:${projectId ?? "__unsaved__"}`;
}

function clearUnsavedStudioDraft(userId: string) {
  try {
    localStorage.removeItem(studioDraftStorageKey(userId.trim() || "guest", null));
  } catch {
    /* ignore */
  }
}

const LAST_STUDIO_PROJECT_PREFIX = "nodly_last_studio_project_v1:";

function readLastStudioProjectId(userId: string): string | null {
  try {
    const raw = localStorage.getItem(`${LAST_STUDIO_PROJECT_PREFIX}${userId.trim() || "guest"}`);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writeLastStudioProjectId(userId: string, projectId: string) {
  try {
    localStorage.setItem(`${LAST_STUDIO_PROJECT_PREFIX}${userId.trim() || "guest"}`, projectId);
  } catch {
    /* ignore */
  }
}

function clearLastStudioProjectId(userId: string) {
  try {
    localStorage.removeItem(`${LAST_STUDIO_PROJECT_PREFIX}${userId.trim() || "guest"}`);
  } catch {
    /* ignore */
  }
}

/** Немедленный снимок мини-студии в облако (после обучения / предсказания). */
async function flushMiniProjectToCloud(): Promise<void> {
  await Promise.resolve();
  const st = useAppStore.getState();
  const meta = st.activeProject;
  if (!meta?.id || meta.readOnly) {
    return;
  }
  if (!useSessionStore.getState().user?.id) {
    return;
  }
  try {
    const liveBlockly = (window as Window & { __nodlyGetBlocklyState?: () => string }).__nodlyGetBlocklyState?.();
    if (typeof liveBlockly === "string" && liveBlockly.trim()) {
      st.setBlocklyState(liveBlockly);
    }
    const snap = st.getProjectSnapshot();
    const now = new Date().toISOString();
    await saveProjectSmart({
      meta: {
        id: meta.id,
        userId: meta.userId,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: now
      },
      snapshot: {
        ...snap,
        blocklyState:
          typeof liveBlockly === "string" && liveBlockly.trim() ? liveBlockly : snap.blocklyState
      }
    });
    useAppStore.getState().setActiveProject({ ...meta, updatedAt: now });
  } catch (e) {
    console.warn("[mini studio] snapshot persist failed", e);
  }
}

type StudioDraftPayload = {
  snapshot: NodlyProjectSnapshot;
  saveTitle: string;
};

const GRADEABLE_STATUSES = ["submitted", "pending_teacher_review", "needs_revision", "graded"] as const;

export function StudioPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isMini = searchParams.get("mini") === "1";
  const miniLessonId = searchParams.get("miniLessonId");
  const miniBlockId = searchParams.get("miniBlockId");
  type MiniCoachPayload = { instruction: string; goals: StudioGoal[] };
  const [miniCoach, setMiniCoach] = useState<MiniCoachPayload | null>(null);
  const [goalUiStatus, setGoalUiStatus] = useState<Record<string, boolean>>({});
  const [allLessonGoalsDone, setAllLessonGoalsDone] = useState(false);
  const miniTelemetryRef = useRef({ trained: false, predicted: false });
  const lastPostedGoalsJson = useRef<string>("");
  const [messageApi, contextHolder] = message.useMessage();
  const [guestUserId] = useState(() => {
    const stored =
      localStorage.getItem(GUEST_USER_ID_KEY) ?? localStorage.getItem(LEGACY_GUEST_USER_ID_KEY);
    if (stored) {
      if (!localStorage.getItem(GUEST_USER_ID_KEY)) {
        localStorage.setItem(GUEST_USER_ID_KEY, stored);
        localStorage.removeItem(LEGACY_GUEST_USER_ID_KEY);
      }
      return stored;
    }
    const next = `guest_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(GUEST_USER_ID_KEY, next);
    return next;
  });
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [dataLibraryOpen, setDataLibraryOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState(DEFAULT_PROJECT_TITLE);
  const [miniSaveToProjectsOpen, setMiniSaveToProjectsOpen] = useState(false);
  const [miniSaveToProjectsTitle, setMiniSaveToProjectsTitle] = useState("");
  const [renameProjectOpen, setRenameProjectOpen] = useState(false);
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [renameProjectTitle, setRenameProjectTitle] = useState("");
  const [renamingProject, setRenamingProject] = useState(false);
  const [lessonPresentation, setLessonPresentation] = useState(false);
  const [projectItems, setProjectItems] = useState<NodlyProjectMeta[]>([]);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [submittingAssignment, setSubmittingAssignment] = useState(false);
  const [submissionCtx, setSubmissionCtx] = useState<SubmissionContext | null>(null);
  const [teacherReview, setTeacherReview] = useState<TeacherWorkReview | null>(null);
  const [teacherReviewModalOpen, setTeacherReviewModalOpen] = useState(true);
  const [teacherGrading, setTeacherGrading] = useState(false);
  const [teacherGradeForm] = Form.useForm();
  const {
    getProjectSnapshot,
    loadProjectSnapshot,
    activeProject,
    setActiveProject,
    imageDatasets,
    tabularDatasets,
    imagePredictionInputs,
    tabularPredictionInputs,
    savedModels,
    blocklyState,
    workspaceLevel,
    evaluation,
    trainingRunReport,
    prediction,
    modelComparisonReport
  } = useAppStore();
  const { user } = useSessionStore();
  const resolvedUserId = user?.id ?? guestUserId;
  const currentProjectTitle = activeProject?.title ?? DEFAULT_PROJECT_TITLE;
  const readOnly = Boolean(activeProject?.readOnly);
  const draftKey = useMemo(
    () => studioDraftStorageKey(resolvedUserId.trim() || "guest", activeProject?.id ?? null),
    [resolvedUserId, activeProject?.id]
  );
  const restoringDraftRef = useRef(false);
  /** После первого запуска bootstrap (облако или черновик __unsaved__). */
  const studioBootstrapDoneRef = useRef(false);
  /** После загрузки последнего облачного проекта не затирать его устаревшим локальным черновиком. */
  const skipNextDraftOverlayRef = useRef(false);
  const [, bumpPostStudioBootstrap] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    studioBootstrapDoneRef.current = false;
    skipNextDraftOverlayRef.current = false;
  }, [resolvedUserId]);

  useEffect(() => {
    if (!isMini || !miniLessonId || !miniBlockId) {
      setMiniCoach(null);
      return;
    }
    try {
      const raw = sessionStorage.getItem(`nodly_mini_ctx__${miniLessonId}__${miniBlockId}`);
      if (!raw) {
        setMiniCoach({ instruction: "", goals: [] });
        return;
      }
      const parsed = JSON.parse(raw) as { instruction?: string; goals?: StudioGoal[] };
      setMiniCoach({
        instruction: typeof parsed.instruction === "string" ? parsed.instruction : "",
        goals: Array.isArray(parsed.goals) ? parsed.goals : []
      });
    } catch {
      setMiniCoach({ instruction: "", goals: [] });
    }
  }, [isMini, miniLessonId, miniBlockId]);

  useEffect(() => {
    if (!isMini) {
      return;
    }
    miniTelemetryRef.current = { trained: false, predicted: false };
    setGoalUiStatus({});
    setAllLessonGoalsDone(false);
    lastPostedGoalsJson.current = "";
  }, [isMini, miniLessonId, miniBlockId]);

  useEffect(() => {
    if (!isMini || !miniLessonId || !miniBlockId) {
      return;
    }
    const tick = () => {
      const goals = miniCoach?.goals ?? [];
      if (goals.length === 0) {
        return;
      }
      const live = (window as Window & { __nodlyGetBlocklyState?: () => string }).__nodlyGetBlocklyState?.();
      const summary = summarizeBlocklyState(typeof live === "string" ? live : "");
      const tel: MiniDevTelemetry = { ...miniTelemetryRef.current };
      const next: Record<string, boolean> = {};
      for (const g of goals) {
        next[g.id] = evalMiniStudioGoal(g, summary, tel);
      }
      const allDone = goals.every((g) => next[g.id]);
      setGoalUiStatus((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setAllLessonGoalsDone((prev) => (prev === allDone ? prev : allDone));
      const payloadJson = JSON.stringify({ goalStatus: next, allDone });
      if (payloadJson !== lastPostedGoalsJson.current) {
        lastPostedGoalsJson.current = payloadJson;
        window.parent?.postMessage(
          {
            source: "nodly-mini-goals",
            lessonId: miniLessonId,
            blockId: miniBlockId,
            goalStatus: next,
            allDone
          },
          window.location.origin
        );
      }
    };
    tick();
    const id = window.setInterval(tick, 1200);
    return () => window.clearInterval(id);
  }, [isMini, miniLessonId, miniBlockId, miniCoach]);

  const refreshProjects = async (nextUserId: string) => {
    const list = await listProjects(nextUserId.trim());
    setProjectItems(list);
  };

  useEffect(() => {
    void refreshProjects(resolvedUserId);
  }, [resolvedUserId]);

  const projectFromUrlEarly = searchParams.get("project");
  const reviewSubmissionIdEarly = searchParams.get("reviewSubmission");

  useEffect(() => {
    if (isMini || readOnly || projectFromUrlEarly || reviewSubmissionIdEarly) {
      return;
    }
    if (studioBootstrapDoneRef.current) {
      return;
    }
    let cancelled = false;
    restoringDraftRef.current = true;
    const uid = resolvedUserId.trim() || "guest";
    void (async () => {
      try {
        const lastId = readLastStudioProjectId(uid);
        if (lastId) {
          const project = await loadProjectSmart(lastId);
          if (cancelled) {
            return;
          }
          if (project && !project.meta.readOnly) {
            setActiveProject(project.meta);
            loadProjectSnapshot(project.snapshot);
            setSaveTitle(project.meta.title);
            skipNextDraftOverlayRef.current = true;
            return;
          }
          clearLastStudioProjectId(uid);
        }
        const raw = localStorage.getItem(studioDraftStorageKey(uid, null));
        if (raw) {
          const parsed = JSON.parse(raw) as StudioDraftPayload;
          if (parsed?.snapshot && typeof parsed.snapshot === "object") {
            loadProjectSnapshot(parsed.snapshot);
          }
          if (typeof parsed?.saveTitle === "string" && parsed.saveTitle.trim()) {
            setSaveTitle(parsed.saveTitle);
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) {
          studioBootstrapDoneRef.current = true;
          bumpPostStudioBootstrap();
          queueMicrotask(() => {
            restoringDraftRef.current = false;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isMini,
    readOnly,
    projectFromUrlEarly,
    reviewSubmissionIdEarly,
    resolvedUserId,
    loadProjectSnapshot,
    setActiveProject,
    setSaveTitle
  ]);

  useEffect(() => {
    if (isMini) {
      return;
    }
    if (!studioBootstrapDoneRef.current) {
      return;
    }
    if (skipNextDraftOverlayRef.current) {
      skipNextDraftOverlayRef.current = false;
      return;
    }
    restoringDraftRef.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as StudioDraftPayload;
        if (parsed?.snapshot && typeof parsed.snapshot === "object") {
          loadProjectSnapshot(parsed.snapshot);
        }
        if (typeof parsed?.saveTitle === "string" && parsed.saveTitle.trim()) {
          setSaveTitle(parsed.saveTitle);
        }
      }
    } catch {
      /* ignore malformed local draft */
    } finally {
      queueMicrotask(() => {
        restoringDraftRef.current = false;
      });
    }
  }, [draftKey, isMini, loadProjectSnapshot, bumpPostStudioBootstrap]);

  useEffect(() => {
    if (readOnly || restoringDraftRef.current) {
      return;
    }
    try {
      const payload: StudioDraftPayload = {
        snapshot: getProjectSnapshot(),
        saveTitle
      };
      localStorage.setItem(draftKey, JSON.stringify(payload));
    } catch {
      /* localStorage may be unavailable/full */
    }
  }, [
    draftKey,
    readOnly,
    saveTitle,
    getProjectSnapshot,
    imageDatasets,
    tabularDatasets,
    imagePredictionInputs,
    tabularPredictionInputs,
    savedModels,
    blocklyState,
    workspaceLevel,
    evaluation,
    trainingRunReport,
    prediction,
    modelComparisonReport
  ]);

  useEffect(() => {
    if (!readOnly) {
      setTeacherReview(null);
      teacherGradeForm.resetFields();
    }
  }, [readOnly, teacherGradeForm]);

  useEffect(() => {
    if (readOnly && teacherReview) {
      setTeacherReviewModalOpen(true);
    }
  }, [readOnly, teacherReview?.submissionId]);

  useEffect(() => {
    if (!teacherReview) {
      return;
    }
    teacherGradeForm.setFieldsValue({
      decision: "grade",
      score: teacherReview.score ?? teacherReview.maxScore,
      comment: teacherReview.revisionNote || teacherReview.teacherNote || ""
    });
  }, [teacherReview?.submissionId, teacherGradeForm, teacherReview]);

  const projectFromUrl = searchParams.get("project");
  const teacherReviewSubmissionParam = searchParams.get("teacherReviewSubmission");

  useEffect(() => {
    if (!isMini || !projectFromUrl || !user || user.role !== "teacher" || !teacherReviewSubmissionParam) {
      return;
    }
    let cancelled = false;
    restoringDraftRef.current = true;
    void (async () => {
      try {
        const project = await loadTeacherReviewMiniProject(teacherReviewSubmissionParam, projectFromUrl);
        if (cancelled) {
          return;
        }
        if (!project) {
          messageApi.error("Не удалось открыть проект ученика");
          return;
        }
        setActiveProject(project.meta);
        loadProjectSnapshot(project.snapshot);
        setSaveTitle(project.meta.title);
        studioBootstrapDoneRef.current = true;
        bumpPostStudioBootstrap();
        messageApi.success("Проект ученика (только просмотр)");
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("project");
            return next;
          },
          { replace: true }
        );
      } catch {
        if (!cancelled) {
          messageApi.error("Не удалось открыть проект ученика");
        }
      } finally {
        if (!cancelled) {
          queueMicrotask(() => {
            restoringDraftRef.current = false;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isMini,
    projectFromUrl,
    teacherReviewSubmissionParam,
    user?.role,
    user?.id,
    loadProjectSnapshot,
    setActiveProject,
    setSaveTitle,
    setSearchParams,
    messageApi,
    bumpPostStudioBootstrap
  ]);

  useEffect(() => {
    if (!projectFromUrl || !user) {
      return;
    }
    if (isMini && user.role === "teacher" && teacherReviewSubmissionParam) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const project = await loadProjectSmart(projectFromUrl);
      if (cancelled) {
        return;
      }
      if (!project) {
        messageApi.error("Проект не найден");
        return;
      }
      setActiveProject(project.meta);
      loadProjectSnapshot(project.snapshot);
      setSaveTitle(project.meta.title);
      if (!isMini && !project.meta.readOnly) {
        writeLastStudioProjectId(resolvedUserId.trim() || "guest", project.meta.id);
      }
      messageApi.success(`Загружен проект: ${project.meta.title}`);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("project");
          return next;
        },
        { replace: true }
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [
    projectFromUrl,
    user?.id,
    user?.role,
    isMini,
    teacherReviewSubmissionParam,
    resolvedUserId,
    setSearchParams,
    setActiveProject,
    loadProjectSnapshot,
    messageApi
  ]);

  const reviewSubmissionId = searchParams.get("reviewSubmission");
  useEffect(() => {
    if (!reviewSubmissionId || user?.role !== "teacher") {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiClient.get<TeacherWorkPayload>(
          `/api/teacher/submissions/${encodeURIComponent(reviewSubmissionId)}/work`
        );
        if (cancelled) {
          return;
        }
        setActiveProject(data.meta);
        loadProjectSnapshot(data.snapshot);
        setSaveTitle(data.meta.title);
        setTeacherReview(data.review);
        messageApi.success("Открыта работа ученика");
        if (data.review.status === "submitted" || data.review.status === "pending_teacher_review") {
          void apiClient
            .post("/api/teacher/submissions/mark-seen", { submissionIds: [data.review.submissionId] })
            .then(() => window.dispatchEvent(new Event("nodly-refresh-header-summary")))
            .catch(() => {});
        }
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("reviewSubmission");
            return next;
          },
          { replace: true }
        );
      } catch {
        if (!cancelled) {
          messageApi.error("Не удалось загрузить работу");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    reviewSubmissionId,
    user?.role,
    setSearchParams,
    setActiveProject,
    loadProjectSnapshot,
    messageApi
  ]);

  useEffect(() => {
    if (!user || user.role !== "student" || !activeProject?.id || activeProject.readOnly) {
      setSubmissionCtx(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await apiClient.get<SubmissionContext>(
          `/api/student/projects/${encodeURIComponent(activeProject.id)}/submission-context`
        );
        if (!cancelled) {
          setSubmissionCtx(ctx);
        }
      } catch {
        if (!cancelled) {
          setSubmissionCtx(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.role, user?.id, activeProject?.id, activeProject?.readOnly]);

  const submitTeacherGradeFromStudio = async () => {
    if (!teacherReview) {
      return;
    }
    setTeacherGrading(true);
    try {
      const v = await teacherGradeForm.validateFields();
      const raw = typeof v.comment === "string" ? v.comment.trim() : "";
      const comment = raw.length > 0 ? raw : null;
      await apiClient.post(`/api/teacher/submissions/${teacherReview.submissionId}/grade`, {
        decision: v.decision,
        score: v.decision === "grade" ? v.score : null,
        teacherNote: v.decision === "grade" ? comment : null,
        revisionNote: v.decision === "revision" ? comment : null
      });
      const data = await apiClient.get<TeacherWorkPayload>(
        `/api/teacher/submissions/${encodeURIComponent(teacherReview.submissionId)}/work`
      );
      setTeacherReview(data.review);
      window.dispatchEvent(new Event("nodly-refresh-header-summary"));
      messageApi.success("Решение сохранено");
    } catch (e) {
      if (e instanceof Error) {
        messageApi.error(e.message);
      }
    } finally {
      setTeacherGrading(false);
    }
  };

  const saveProjectToCloud = async (
    titleRaw: string,
    opts?: { detachLessonTemplate?: boolean; silent?: boolean; skipRefreshProjects?: boolean }
  ) => {
    if (readOnly) {
      messageApi.warning("Режим только просмотра — сохранение в облако отключено.");
      return;
    }
    const normalizedUserId = resolvedUserId.trim();
    const normalizedTitle = titleRaw.trim();
    if (!normalizedTitle) {
      messageApi.error("Укажи название проекта.");
      return;
    }
    const now = new Date().toISOString();
    const projectId = activeProject?.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const liveBlocklyState = (window as Window & { __nodlyGetBlocklyState?: () => string }).__nodlyGetBlocklyState?.();
    if (typeof liveBlocklyState === "string" && liveBlocklyState.trim()) {
      useAppStore.getState().setBlocklyState(liveBlocklyState);
    }
    const snapshot = getProjectSnapshot();
    await saveProjectSmart(
      {
        meta: {
          id: projectId,
          userId: normalizedUserId,
          title: normalizedTitle,
          createdAt: activeProject?.createdAt ?? now,
          updatedAt: now
        },
        snapshot: {
          ...snapshot,
          blocklyState:
            typeof liveBlocklyState === "string" && liveBlocklyState.trim()
              ? liveBlocklyState
              : snapshot.blocklyState
        }
      },
      opts?.detachLessonTemplate ? { detachLessonTemplate: true } : undefined
    );
    setActiveProject({
      id: projectId,
      userId: normalizedUserId,
      title: normalizedTitle,
      createdAt: activeProject?.createdAt ?? now,
      updatedAt: now
    });
    if (!isMini) {
      writeLastStudioProjectId(normalizedUserId, projectId);
    }
    if (!opts?.skipRefreshProjects) {
      await refreshProjects(normalizedUserId);
    }
    if (!opts?.silent) {
      messageApi.success("Проект сохранен");
    }
  };

  useEffect(() => {
    if (!isMini || readOnly) {
      return;
    }
    const onPersist = () => {
      void flushMiniProjectToCloud();
    };
    window.addEventListener("nodly-persist-studio", onPersist);
    return () => window.removeEventListener("nodly-persist-studio", onPersist);
  }, [isMini, readOnly]);

  /** Мини-студия: догоняющее автосохранение (редактирование данных / блоков). Сразу после обучения — событие nodly-persist-studio. */
  useEffect(() => {
    if (!isMini || !user?.id || readOnly || !activeProject?.id) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) {
          return;
        }
        await flushMiniProjectToCloud();
      })();
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    isMini,
    user?.id,
    readOnly,
    activeProject?.id,
    activeProject?.title,
    activeProject?.userId,
    activeProject?.createdAt,
    blocklyState,
    workspaceLevel,
    evaluation,
    trainingRunReport,
    prediction,
    modelComparisonReport,
    imageDatasets,
    tabularDatasets,
    savedModels,
    imagePredictionInputs,
    tabularPredictionInputs
  ]);

  useEffect(() => {
    if (!isMini) {
      return;
    }
    const handler = (evt: MessageEvent) => {
      if (evt.origin !== window.location.origin) {
        return;
      }
      const data = evt.data as { source?: string; type?: string; value?: unknown } | null;
      if (!data || data.source !== "nodly-lesson" || data.type !== "presentation") {
        return;
      }
      setLessonPresentation(Boolean(data.value));
    };
    window.addEventListener("message", handler);
    try {
      window.parent?.postMessage(
        { source: "nodly-mini-studio", type: "presentation-query" },
        window.location.origin
      );
    } catch {
      // ignore cross-origin
    }
    return () => window.removeEventListener("message", handler);
  }, [isMini]);

  const handleSave = async () => {
    await saveProjectToCloud(saveTitle);
    setSaveOpen(false);
  };

  const openRenameProjectModal = (projectId: string, currentTitle: string) => {
    setRenameProjectId(projectId);
    setRenameProjectTitle(currentTitle);
    setRenameProjectOpen(true);
  };

  const submitRenameProject = async () => {
    if (!renameProjectId) {
      return;
    }
    const nextTitle = renameProjectTitle.trim();
    if (!nextTitle) {
      messageApi.error("Название проекта не может быть пустым");
      return;
    }
    setRenamingProject(true);
    try {
      const loaded = await loadProjectSmart(renameProjectId);
      if (!loaded) {
        throw new Error("Проект не найден");
      }
      const now = new Date().toISOString();
      await saveProjectSmart({
        meta: { ...loaded.meta, title: nextTitle, updatedAt: now },
        snapshot: loaded.snapshot
      });
      if (activeProject?.id === renameProjectId) {
        setActiveProject({ ...activeProject, title: nextTitle, updatedAt: now });
        setSaveTitle(nextTitle);
      }
      await refreshProjects(resolvedUserId);
      setRenameProjectOpen(false);
      messageApi.success("Название проекта обновлено");
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось переименовать проект");
    } finally {
      setRenamingProject(false);
    }
  };

  const handleMiniSaveToProjects = () => {
    const cur = (activeProject?.title ?? "").trim();
    setMiniSaveToProjectsTitle(cur && cur !== DEFAULT_PROJECT_TITLE ? cur : "");
    setMiniSaveToProjectsOpen(true);
  };

  const submitMiniSaveToProjects = async () => {
    const t = miniSaveToProjectsTitle.trim();
    if (!t) {
      messageApi.error("Введи название — так проект появится в списке «Проекты».");
      return;
    }
    try {
      await saveProjectToCloud(t, { detachLessonTemplate: true });
      setMiniSaveToProjectsOpen(false);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось сохранить в проекты");
    }
  };

  const handleMiniStudioActivity = (event: {
    type: "train" | "predict";
    modelType: string;
    datasetRef?: string;
    inputRef?: string;
    label?: string | null;
  }) => {
    if (event.type === "train") {
      miniTelemetryRef.current.trained = true;
    }
    if (event.type === "predict") {
      miniTelemetryRef.current.predicted = true;
    }
    if (!isMini || !miniLessonId || !miniBlockId) {
      return;
    }
    window.parent?.postMessage(
      {
        source: "nodly-mini-studio",
        lessonId: miniLessonId,
        blockId: miniBlockId,
        projectId: activeProject?.id ?? null,
        event
      },
      window.location.origin
    );
  };

  const handleLoadProject = async (projectId: string) => {
    const project = await loadProjectSmart(projectId);
    if (!project) {
      messageApi.error("Проект не найден");
      return;
    }
    setActiveProject(project.meta);
    loadProjectSnapshot(project.snapshot);
    if (!project.meta.readOnly) {
      writeLastStudioProjectId(resolvedUserId.trim() || "guest", project.meta.id);
    }
    setLibraryOpen(false);
    messageApi.success(`Загружен проект: ${project.meta.title}`);
  };

  const handleNewProject = () => {
    clearLastStudioProjectId(resolvedUserId.trim() || "guest");
    clearUnsavedStudioDraft(resolvedUserId);
    setActiveProject(null);
    loadProjectSnapshot(EMPTY_SNAPSHOT);
    setSaveTitle(DEFAULT_PROJECT_TITLE);
    setSubmissionCtx(null);
    messageApi.success("Черновик нового проекта. Сохрани, когда будет готово.");
  };

  const handleSubmitFromStudio = async () => {
    if (!submissionCtx?.canSubmit || !activeProject?.id || readOnly) {
      return;
    }
    setSubmittingAssignment(true);
    try {
      const normalizedUserId = resolvedUserId.trim();
      const now = new Date().toISOString();
      const liveBlocklyState = (window as Window & { __nodlyGetBlocklyState?: () => string }).__nodlyGetBlocklyState?.();
      if (typeof liveBlocklyState === "string" && liveBlocklyState.trim()) {
        useAppStore.getState().setBlocklyState(liveBlocklyState);
      }
      const snap = getProjectSnapshot();
      await saveProjectSmart({
        meta: {
          id: activeProject.id,
          userId: normalizedUserId,
          title: activeProject.title,
          createdAt: activeProject.createdAt,
          updatedAt: now
        },
        snapshot: {
          ...snap,
          blocklyState:
            typeof liveBlocklyState === "string" && liveBlocklyState.trim()
              ? liveBlocklyState
              : snap.blocklyState
        }
      });
      await apiClient.post(`/api/student/assignments/${submissionCtx.assignmentId}/submit`, {});
      messageApi.success("Работа сохранена и сдана учителю");
      window.dispatchEvent(new Event("nodly-refresh-header-summary"));
      const ctx = await apiClient.get<SubmissionContext>(
        `/api/student/projects/${encodeURIComponent(activeProject.id)}/submission-context`
      );
      setSubmissionCtx(ctx);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось сдать");
    } finally {
      setSubmittingAssignment(false);
    }
  };

  const teacherMessageForStudent =
    submissionCtx && (submissionCtx.revisionNote || submissionCtx.teacherNote)
      ? [submissionCtx.revisionNote, submissionCtx.teacherNote]
          .filter((x, i, a) => Boolean(x) && a.indexOf(x) === i)
          .join("\n\n")
      : "";

  const showTeacherGradePanel =
    readOnly &&
    teacherReview &&
    (GRADEABLE_STATUSES as readonly string[]).includes(teacherReview.status);

  const submissionBanner =
    !readOnly && submissionCtx ? (
      <Alert
        type={submissionCtx.status === "needs_revision" ? "warning" : "info"}
        showIcon
        message={
          <span>
            Задание: <strong>{submissionCtx.assignmentTitle}</strong> ({submissionCtx.classroomTitle})
          </span>
        }
        description={
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            {teacherMessageForStudent ? (
              <div>
                <Text strong>Сообщение учителя:</Text>
                <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{teacherMessageForStudent}</Paragraph>
              </div>
            ) : null}
            {(submissionCtx.status === "graded" || submissionCtx.status === "auto_checked") && submissionCtx.score != null ? (
              <Text>
                Оценка: {submissionCtx.score} / {submissionCtx.maxScore}
              </Text>
            ) : null}
            {submissionCtx.status === "pending_teacher_review" && submissionCtx.autoScore != null ? (
              <Text>
                Предварительный балл (авто): {submissionCtx.autoScore} / {submissionCtx.maxScore}
              </Text>
            ) : null}
            {submissionCtx.canSubmit ? (
              <Button type="primary" loading={submittingAssignment} onClick={() => void handleSubmitFromStudio()}>
                Сохранить в облако и сдать учителю
              </Button>
            ) : submissionCtx.status === "submitted" || submissionCtx.status === "pending_teacher_review" ? (
              <Text type="secondary">Работа сдана, жди проверки.</Text>
            ) : null}
          </Space>
        }
      />
    ) : null;

  const projectWorkspace = (
    <div className="studio-page">
      {submissionBanner ? <div className="studio-page__chrome">{submissionBanner}</div> : null}
      {!isMini ? <div className="studio-page__toolbar">
        <span className="studio-page__toolbar-title" title={currentProjectTitle}>
          {currentProjectTitle}
        </span>
        {!readOnly && activeProject ? (
          <Button
            size="small"
            icon={<FormOutlined />}
            onClick={() => openRenameProjectModal(activeProject.id, activeProject.title)}
          >
            Переименовать
          </Button>
        ) : null}
        <Button
          type="primary"
          size="small"
          disabled={readOnly}
          onClick={() => {
            if (activeProject) {
              void saveProjectToCloud(currentProjectTitle || saveTitle || DEFAULT_PROJECT_TITLE);
              return;
            }
            setSaveTitle(currentProjectTitle);
            setSaveOpen(true);
          }}
        >
          Сохранить
        </Button>
        <Button size="small" onClick={() => setLibraryOpen(true)}>
          Проекты
        </Button>
        <Button size="small" onClick={handleNewProject}>
          Новый
        </Button>
        <Button size="small" icon={<DatabaseOutlined />} onClick={() => setDataLibraryOpen(true)}>
          Данные
        </Button>
        {user && activeProject && !readOnly ? (
          <Button
            size="small"
            onClick={() =>
              void (async () => {
                try {
                  const { token } = await apiClient.post<{ token: string }>(
                    `/api/projects/${activeProject.id}/share-link`,
                    {}
                  );
                  const url = `${window.location.origin}/share/${token}`;
                  await navigator.clipboard.writeText(url);
                  messageApi.success("Ссылка для копии проекта скопирована");
                } catch {
                  messageApi.error("Не удалось создать ссылку (сохрани проект в облако)");
                }
              })()
            }
          >
            Поделиться
          </Button>
        ) : null}
      </div> : null}
      <div
        className={`studio-page__main${
          isMini && miniLessonId && miniBlockId ? " studio-page__main--mini-side" : ""
        }`}
      >
        <div className="studio-page__blockly">
          <BlocklyWorkspace
            miniStudioToolbar={isMini}
            miniCoachGoals={
              isMini && miniLessonId && miniBlockId
                ? { goals: miniCoach?.goals ?? [], goalStatus: goalUiStatus, allGoalsDone: allLessonGoalsDone }
                : undefined
            }
            onOpenDataLibrary={isMini ? () => setDataLibraryOpen(true) : undefined}
            onSaveProject={isMini && !readOnly ? () => void handleMiniSaveToProjects() : undefined}
            onMiniStudioActivity={handleMiniStudioActivity}
          />
        </div>
        {isMini && miniLessonId && miniBlockId ? (
          <StudioSidePanelTabs
            variant="mini"
            instructionMarkdown={miniCoach?.instruction ?? ""}
            goals={miniCoach?.goals ?? []}
            goalStatus={goalUiStatus}
            allGoalsDone={allLessonGoalsDone}
            showGoalsInPanel={false}
          />
        ) : null}
        {!isMini ? <StudioSidePanelTabs variant="full" /> : null}
      </div>
    </div>
  );

  return (
    <Content
      className={`app-content app-content--workspace${isMini ? " studio-mini-host" : ""}${
        isMini && lessonPresentation ? " studio-mini-host--presentation" : ""
      }`}
    >
      {contextHolder}
      {!isMini && user ? (
        <Tabs
          className="studio-workspace-tabs"
          defaultActiveKey="project"
          items={[
            { key: "project", label: "Проект", children: projectWorkspace },
            { key: "sprite", label: "Персонаж", children: <StudioSpriteSettingsTab /> }
          ]}
        />
      ) : (
        projectWorkspace
      )}
      {isMini ? (
        <>
          <Modal
            title="Данные проекта"
            open={dataLibraryOpen}
            onCancel={() => setDataLibraryOpen(false)}
            footer={null}
            width="min(1120px, 96vw)"
            destroyOnClose={false}
            centered
            rootClassName="studio-data-modal"
          >
            <DataLibrary />
          </Modal>
          <Modal
            title="Сохранить в проекты"
            open={miniSaveToProjectsOpen}
            okText="Сохранить"
            cancelText="Отмена"
            onOk={() => void submitMiniSaveToProjects()}
            onCancel={() => setMiniSaveToProjectsOpen(false)}
            destroyOnClose
            centered
          >
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Придумай имя проекта — оно будет в списке «Проекты» в разработке.
              </Paragraph>
              <Input
                value={miniSaveToProjectsTitle}
                onChange={(e) => setMiniSaveToProjectsTitle(e.target.value)}
                placeholder="Например: Практика — ирисы"
                maxLength={120}
                autoFocus
              />
            </Space>
          </Modal>
        </>
      ) : (
        <Drawer
          title="Данные проекта"
          placement="right"
          width={580}
          open={dataLibraryOpen}
          onClose={() => setDataLibraryOpen(false)}
          destroyOnClose={false}
          rootClassName="studio-data-drawer"
        >
          <DataLibrary variant="drawer" />
        </Drawer>
      )}
      {!isMini ? (
        <>
      <Drawer
        title={`Проекты: ${user?.nickname ?? "Черновик"}`}
        open={libraryOpen}
        width={460}
        onClose={() => setLibraryOpen(false)}
      >
        <List
          dataSource={projectItems}
          locale={{ emptyText: "Проекты не найдены" }}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button key="load" type="link" onClick={() => void handleLoadProject(item.id)}>
                  Загрузить
                </Button>,
                <Button
                  key="rename"
                  type="link"
                  onClick={() => openRenameProjectModal(item.id, item.title)}
                >
                  Переименовать
                </Button>,
                <Popconfirm
                  key="delete"
                  title="Удалить проект?"
                  okText="Удалить"
                  cancelText="Отмена"
                  onConfirm={async () => {
                    setDeletingProjectId(item.id);
                    try {
                      await deleteProjectSmart(item.id);
                      messageApi.success("Проект удалён");
                      await refreshProjects(resolvedUserId);
                      const uid = resolvedUserId.trim() || "guest";
                      if (readLastStudioProjectId(uid) === item.id) {
                        clearLastStudioProjectId(uid);
                      }
                      if (activeProject?.id === item.id) {
                        clearLastStudioProjectId(uid);
                        clearUnsavedStudioDraft(resolvedUserId);
                        setActiveProject(null);
                        loadProjectSnapshot(EMPTY_SNAPSHOT);
                        setSaveTitle(DEFAULT_PROJECT_TITLE);
                      }
                    } catch (e) {
                      messageApi.error(e instanceof Error ? e.message : "Не удалось удалить проект");
                    } finally {
                      setDeletingProjectId(null);
                    }
                  }}
                >
                  <Button key="delete-btn" type="link" danger loading={deletingProjectId === item.id}>
                    Удалить
                  </Button>
                </Popconfirm>
              ]}
            >
              <List.Item.Meta
                title={item.title}
                description={`Обновлен: ${new Date(item.updatedAt).toLocaleString("ru-RU")}`}
              />
            </List.Item>
          )}
        />
      </Drawer>
      <Modal
        open={saveOpen}
        title="Сохранить проект"
        okText="Сохранить"
        okButtonProps={{ disabled: readOnly }}
        onOk={() => void handleSave()}
        onCancel={() => setSaveOpen(false)}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} placeholder="Название проекта" />
        </Space>
      </Modal>
      <Modal
        open={renameProjectOpen}
        title="Переименовать проект"
        okText="Сохранить"
        confirmLoading={renamingProject}
        onOk={() => void submitRenameProject()}
        onCancel={() => setRenameProjectOpen(false)}
      >
        <Input
          value={renameProjectTitle}
          onChange={(e) => setRenameProjectTitle(e.target.value)}
          placeholder="Новое название проекта"
          maxLength={120}
        />
      </Modal>
        </>
      ) : null}
      <Modal
        open={Boolean(readOnly && teacherReview && teacherReviewModalOpen)}
        title={
          showTeacherGradePanel && teacherReview
            ? `Проверка: ${teacherReview.assignmentTitle} (${teacherReview.studentNickname})`
            : "Работа ученика"
        }
        onCancel={() => setTeacherReviewModalOpen(false)}
        footer={null}
        width={560}
        destroyOnClose={false}
        centered
        zIndex={1100}
        maskClosable
        rootClassName="studio-teacher-review-modal"
      >
        {teacherReview ? (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              message="Работа ученика"
              description={
                <span>
                  Проект только для просмотра. Оценку и доработку оформляйте в этом окне. Раздел{" "}
                  <Link to="/teacher">кабинет учителя</Link> — список всех сдач.
                </span>
              }
            />
            {showTeacherGradePanel ? (
              <>
                <Paragraph type="secondary" style={{ marginTop: 0 }}>
                  Статус сдачи:{" "}
                  <Text strong>
                    {teacherReview.status === "submitted" || teacherReview.status === "pending_teacher_review"
                      ? "сдано"
                      : teacherReview.status === "needs_revision"
                        ? "доработка"
                        : teacherReview.status === "graded"
                          ? `оценено (${teacherReview.score ?? "—"}/${teacherReview.maxScore})`
                          : teacherReview.status}
                  </Text>
                </Paragraph>
                <Form form={teacherGradeForm} layout="vertical">
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
                          extra={`0…${teacherReview.maxScore}`}
                        >
                          <InputNumber min={0} max={teacherReview.maxScore} style={{ width: "100%" }} />
                        </Form.Item>
                      ) : null
                    }
                  </Form.Item>
                  <Form.Item name="comment" label="Комментарий для ученика">
                    <TextArea rows={3} placeholder="Необязательно при оценке, желательно при доработке" />
                  </Form.Item>
                  <Button type="primary" loading={teacherGrading} onClick={() => void submitTeacherGradeFromStudio()}>
                    Сохранить решение
                  </Button>
                </Form>
              </>
            ) : (
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Ученик ещё не отправил работу на проверку (черновик).
              </Paragraph>
            )}
          </Space>
        ) : null}
      </Modal>
      {readOnly && teacherReview && !teacherReviewModalOpen ? (
        <FloatButton
          type="primary"
          icon={<FormOutlined />}
          tooltip="Проверка работы"
          onClick={() => setTeacherReviewModalOpen(true)}
        />
      ) : null}
    </Content>
  );
}
