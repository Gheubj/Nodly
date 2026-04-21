import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Layout,
  Select,
  Space,
  Spin,
  Typography,
  message
} from "antd";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { ApiError, apiClient } from "@/shared/api/client";
import { LessonFlowView } from "@/components/LessonFlowView";
import { EMPTY_LESSON_CONTENT, type LessonContent } from "@/shared/types/lessonContent";
import { expandLessonContentToBlocks } from "@/shared/lessonContentBlocks";
import {
  normalizeCheckpointAnswer,
  parseLessonPlayerState,
  type LessonPlayerStateV1
} from "@/shared/types/lessonPlayerState";

const { Content } = Layout;
const { Title, Paragraph } = Typography;
const { TextArea } = Input;

type SubmissionSummary = {
  id: string;
  status: string;
  projectId: string | null;
  canSubmit: boolean;
};

type TeacherReviewInfo = {
  submissionId: string;
  studentNickname: string;
  status: string;
  score: number | null;
  maxScore: number;
  autoScore: number | null;
  manualScore: number | null;
  teacherNote: string | null;
  revisionNote: string | null;
};

type PlayerBootstrap = {
  title: string;
  studentSummary: string | null;
  lessonContent: unknown;
  scopeKey: string;
  assignmentTitle: string | null;
  assignmentKind?: string | null;
  submission?: SubmissionSummary | null;
  review?: TeacherReviewInfo;
  state: unknown;
};

type MiniStudioMessage = {
  source: "nodly-mini-studio";
  lessonId: string;
  blockId: string;
  projectId?: string | null;
  event: {
    type: "train" | "predict";
    modelType: string;
    datasetRef?: string;
    inputRef?: string;
    label?: string | null;
  };
};

type MiniGoalsMessage = {
  source: "nodly-mini-goals";
  lessonId: string;
  blockId: string;
  goalStatus: Record<string, boolean>;
  allDone: boolean;
};

export function LessonPlayerPage() {
  const { user } = useSessionStore();
  const { lessonId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const assignmentId = searchParams.get("assignmentId");
  const reviewSubmissionId = searchParams.get("reviewSubmission");
  const [messageApi, holder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submittingToTeacher, setSubmittingToTeacher] = useState(false);
  const [grading, setGrading] = useState(false);
  const [bootstrap, setBootstrap] = useState<PlayerBootstrap | null>(null);
  const [playerState, setPlayerState] = useState<LessonPlayerStateV1>({ v: 1, checkpoints: {} });
  const [miniProjectIdsLocal, setMiniProjectIdsLocal] = useState<Record<string, string>>({});
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [autoCreatingMini, setAutoCreatingMini] = useState<Record<string, boolean>>({});
  const [gradeForm] = Form.useForm();
  const playerStateRef = useRef(playerState);
  playerStateRef.current = playerState;
  /** Синхронная защита от двойного создания одного и того же mini-проекта (StrictMode / гонки). */
  const miniCreateLockRef = useRef<Record<string, boolean>>({});

  const isTeacherReview = Boolean(user?.role === "teacher" && reviewSubmissionId);

  const lessonContent: LessonContent = useMemo(() => {
    if (!bootstrap?.lessonContent || typeof bootstrap.lessonContent !== "object") {
      return EMPTY_LESSON_CONTENT;
    }
    return { ...EMPTY_LESSON_CONTENT, ...(bootstrap.lessonContent as LessonContent) };
  }, [bootstrap]);

  const flowBlocks = useMemo(() => expandLessonContentToBlocks(lessonContent), [lessonContent]);

  const checkpointBlockIds = useMemo(
    () => flowBlocks.filter((b): b is Extract<(typeof flowBlocks)[0], { type: "checkpoint" }> => b.type === "checkpoint").map((b) => b.id),
    [flowBlocks]
  );

  const persistState = useCallback(
    async (next: LessonPlayerStateV1) => {
      if (isTeacherReview) {
        return;
      }
      const q = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : "";
      setSaving(true);
      try {
        await apiClient.patch(`/api/student/lessons/${encodeURIComponent(lessonId)}/player-progress${q}`, {
          state: next
        });
        setPlayerState(next);
        playerStateRef.current = next;
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : "Не удалось сохранить прогресс");
      } finally {
        setSaving(false);
      }
    },
    [assignmentId, isTeacherReview, lessonId, messageApi]
  );

  const load = useCallback(async () => {
    if (!lessonId) {
      return;
    }
    setLoading(true);
    try {
      if (user?.role === "teacher" && reviewSubmissionId) {
        const data = await apiClient.get<PlayerBootstrap>(
          `/api/teacher/lessons/${encodeURIComponent(lessonId)}/player-review-bootstrap?submissionId=${encodeURIComponent(reviewSubmissionId)}`
        );
        setBootstrap(data);
        const parsed = parseLessonPlayerState(data.state);
        setPlayerState(parsed);
        setMiniProjectIdsLocal(parsed.miniDevProjectIds ?? {});
        playerStateRef.current = parsed;
        void apiClient.post("/api/teacher/submissions/mark-seen", { submissionIds: [reviewSubmissionId] }).catch(() => {});
      } else {
        const q = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : "";
        const data = await apiClient.get<PlayerBootstrap>(
          `/api/student/lessons/${encodeURIComponent(lessonId)}/player-bootstrap${q}`
        );
        setBootstrap(data);
        const parsed = parseLessonPlayerState(data.state);
        setPlayerState(parsed);
        setMiniProjectIdsLocal(parsed.miniDevProjectIds ?? {});
        playerStateRef.current = parsed;
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось загрузить урок");
      setBootstrap(null);
    } finally {
      setLoading(false);
    }
  }, [assignmentId, lessonId, messageApi, reviewSubmissionId, user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const rev = bootstrap?.review;
    if (!isTeacherReview || !rev) {
      return;
    }
    gradeForm.setFieldsValue({
      decision: "grade",
      score: rev.score ?? rev.maxScore,
      comment: rev.revisionNote || rev.teacherNote || ""
    });
  }, [bootstrap?.review?.submissionId, gradeForm, isTeacherReview, bootstrap?.review]);

  const ensureMiniDevProject = useCallback(
    async (blockId: string) => {
      if (isTeacherReview || !bootstrap || !lessonId) {
        return;
      }
      if (miniCreateLockRef.current[blockId]) {
        return;
      }
      if (playerStateRef.current.miniDevProjectIds?.[blockId]) {
        return;
      }
      miniCreateLockRef.current[blockId] = true;
      setAutoCreatingMini((prev) => ({ ...prev, [blockId]: true }));
      setSaving(true);
      try {
        const q = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : "";
        const { projectId } = await apiClient.post<{ projectId: string }>(
          `/api/student/lessons/${encodeURIComponent(lessonId)}/mini-dev-project${q}`,
          {
            blockId,
            title: `${bootstrap.title} · мини`
          }
        );
        // Отображаем iframe сразу после создания, даже если сохранение прогресса задержалось.
        setMiniProjectIdsLocal((prev) => ({ ...prev, [blockId]: projectId }));
        const prev = playerStateRef.current;
        const next: LessonPlayerStateV1 = {
          ...prev,
          v: 1,
          miniDevProjectIds: {
            ...(prev.miniDevProjectIds ?? {}),
            [blockId]: projectId
          },
          miniDevGoalStatus: {
            ...(prev.miniDevGoalStatus ?? {}),
            [blockId]: {}
          }
        };
        await persistState(next);
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : "Не удалось запустить мини-разработку");
      } finally {
        miniCreateLockRef.current[blockId] = false;
        setAutoCreatingMini((prev) => ({ ...prev, [blockId]: false }));
        setSaving(false);
      }
    },
    [assignmentId, bootstrap, isTeacherReview, lessonId, messageApi, persistState]
  );

  const miniProjectIdsKey = useMemo(() => JSON.stringify(playerState.miniDevProjectIds ?? {}), [playerState.miniDevProjectIds]);

  useEffect(() => {
    if (isTeacherReview || loading || !bootstrap || !lessonId) {
      return;
    }
    const studioIds = flowBlocks.filter((b) => b.type === "studio").map((b) => b.id);
    if (studioIds.length === 0) {
      return;
    }
    const missing = studioIds.filter((id) => !playerStateRef.current.miniDevProjectIds?.[id]);
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const blockId of missing) {
        if (cancelled) {
          return;
        }
        await ensureMiniDevProject(blockId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTeacherReview, loading, bootstrap, lessonId, flowBlocks, miniProjectIdsKey, ensureMiniDevProject]);

  useEffect(() => {
    if (isTeacherReview) {
      return;
    }
    const handler = (evt: MessageEvent<MiniStudioMessage | MiniGoalsMessage>) => {
      if (evt.origin !== window.location.origin) {
        return;
      }
      const payload = evt.data;
      if (!payload || typeof payload !== "object") {
        return;
      }
      if (payload.lessonId !== lessonId) {
        return;
      }
      if (payload.source === "nodly-mini-goals") {
        const blockId = payload.blockId;
        const prev = playerStateRef.current;
        const next: LessonPlayerStateV1 = {
          ...prev,
          miniDevGoalStatus: {
            ...(prev.miniDevGoalStatus ?? {}),
            [blockId]: payload.goalStatus
          },
          miniDevDone: {
            ...(prev.miniDevDone ?? {}),
            [blockId]: Boolean(payload.allDone)
          }
        };
        void persistState(next);
        return;
      }
      if (payload.source !== "nodly-mini-studio") {
        return;
      }
      const blockId = payload.blockId;
      const prev = playerStateRef.current;
      const current = prev.miniDevTelemetry?.[blockId] ?? {};
      const nextTelemetry = {
        ...current,
        lastModelType: payload.event.modelType ?? current.lastModelType ?? null,
        lastDatasetRef: payload.event.datasetRef ?? current.lastDatasetRef ?? null,
        lastInputRef: payload.event.inputRef ?? current.lastInputRef ?? null,
        lastPredictionLabel: payload.event.label ?? current.lastPredictionLabel ?? null,
        trained: current.trained || payload.event.type === "train",
        predicted: current.predicted || payload.event.type === "predict",
        updatedAt: new Date().toISOString()
      };
      const next: LessonPlayerStateV1 = {
        ...prev,
        miniDevTelemetry: {
          ...(prev.miniDevTelemetry ?? {}),
          [blockId]: nextTelemetry
        }
      };
      void persistState(next);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isTeacherReview, lessonId, persistState]);

  const submitGradeFromLesson = useCallback(async () => {
    const rev = bootstrap?.review;
    if (!rev) {
      return;
    }
    setGrading(true);
    try {
      const v = await gradeForm.validateFields();
      const commentRaw = typeof v.comment === "string" ? v.comment.trim() : "";
      const comment = commentRaw.length > 0 ? commentRaw : null;
      await apiClient.post(`/api/teacher/submissions/${encodeURIComponent(rev.submissionId)}/grade`, {
        decision: v.decision,
        score: v.decision === "grade" ? v.score : null,
        teacherNote: v.decision === "grade" ? comment : null,
        revisionNote: v.decision === "revision" ? comment : null
      });
      messageApi.success("Готово");
      await load();
      window.dispatchEvent(new Event("nodly-refresh-header-summary"));
    } catch (e) {
      if (e instanceof Error) {
        messageApi.error(e.message);
      }
    } finally {
      setGrading(false);
    }
  }, [bootstrap?.review, gradeForm, load, messageApi]);

  const submitToTeacher = useCallback(async () => {
    if (!assignmentId || !bootstrap?.submission) {
      return;
    }
    setSubmittingToTeacher(true);
    try {
      await apiClient.post(`/api/student/assignments/${encodeURIComponent(assignmentId)}/submit`, {});
      messageApi.success("Сдано учителю");
      await load();
      window.dispatchEvent(new Event("nodly-refresh-header-summary"));
    } catch (e) {
      const msg = e instanceof ApiError ? e.userMessage : e instanceof Error ? e.message : "Не удалось сдать";
      if (msg === "Start assignment first") {
        try {
          await apiClient.post(`/api/student/assignments/${encodeURIComponent(assignmentId)}/start`, {});
          await apiClient.post(`/api/student/assignments/${encodeURIComponent(assignmentId)}/submit`, {});
          messageApi.success("Сдано учителю");
          await load();
          window.dispatchEvent(new Event("nodly-refresh-header-summary"));
        } catch (e2) {
          messageApi.error(e2 instanceof Error ? e2.message : "Не удалось сдать");
        }
      } else {
        messageApi.error(msg);
      }
    } finally {
      setSubmittingToTeacher(false);
    }
  }, [assignmentId, bootstrap?.submission, load, messageApi]);

  if (!user) {
    return (
      <Content className="app-content">
        <Card>
          <Link to="/">На главную</Link>
        </Card>
      </Content>
    );
  }

  if (user.role === "teacher" && !reviewSubmissionId) {
    return (
      <Content className="app-content">
        <Card title="Плеер урока">
          <Paragraph>Для проверки работы откройте ссылку из кабинета учителя («Открыть работу»).</Paragraph>
          <Link to="/teacher">В кабинет</Link>
        </Card>
      </Content>
    );
  }

  if (user.role !== "student" && user.role !== "admin" && !isTeacherReview) {
    return (
      <Content className="app-content">
        <Card title="Плеер урока">
          <Paragraph>Интерактивное прохождение доступно ученикам и администратору.</Paragraph>
          <Link to="/">На главную</Link>
        </Card>
      </Content>
    );
  }

  const checkpointsOk = (blockId: string) => playerState.checkpoints?.[blockId] === "ok";
  const miniDevDone = (blockId: string) => Boolean(playerState.miniDevDone?.[blockId]);
  const miniDevProjectId = (blockId: string) =>
    playerState.miniDevProjectIds?.[blockId] ?? miniProjectIdsLocal[blockId] ?? null;

  const verifyCheckpoint = async (blockId: string, expected: string) => {
    if (isTeacherReview) {
      return;
    }
    const raw = draftAnswers[blockId] ?? "";
    const block = flowBlocks.find((b): b is Extract<(typeof flowBlocks)[0], { type: "checkpoint" }> => b.type === "checkpoint" && b.id === blockId);
    const mode = block?.answerMode ?? "text";
    const actualNormalized =
      mode === "multi"
        ? raw
            .split("||")
            .map((x) => normalizeCheckpointAnswer(x))
            .filter(Boolean)
            .sort()
            .join("||")
        : normalizeCheckpointAnswer(raw);
    const expectedNormalized =
      mode === "multi"
        ? expected
            .split("||")
            .map((x) => normalizeCheckpointAnswer(x))
            .filter(Boolean)
            .sort()
            .join("||")
        : normalizeCheckpointAnswer(expected);
    if (actualNormalized !== expectedNormalized) {
      messageApi.warning("Пока не совпадает с ожидаемым ответом — попробуй ещё раз.");
      return;
    }
    const next: LessonPlayerStateV1 = {
      ...playerState,
      v: 1,
      checkpoints: { ...playerState.checkpoints, [blockId]: "ok" }
    };
    await persistState(next);
    messageApi.success("Верно!");
  };

  const allCheckpointsDone =
    checkpointBlockIds.length === 0 || checkpointBlockIds.every((id) => checkpointsOk(id));

  const toggleMiniDevDone = async (blockId: string) => {
    if (isTeacherReview) {
      return;
    }
    const next: LessonPlayerStateV1 = {
      ...playerState,
      miniDevDone: {
        ...(playerState.miniDevDone ?? {}),
        [blockId]: !miniDevDone(blockId)
      }
    };
    await persistState(next);
  };

  const submission = bootstrap?.submission;
  const showSubmitToTeacher =
    !isTeacherReview &&
    user.role === "student" &&
    user.studentMode === "school" &&
    Boolean(assignmentId) &&
    Boolean(submission);

  const review = bootstrap?.review;

  return (
    <Content className="app-content app-content--workspace lesson-player-page">
      {holder}
      <Spin spinning={loading}>
        <Space direction="vertical" size="large" style={{ width: "100%" }} className="lesson-player-page__stack">
          <div className="lesson-player-page__head">
            <Title level={4} style={{ marginTop: 0 }} className="lesson-player-page__title">
              {bootstrap?.title ?? "Урок"}
            </Title>
            {isTeacherReview && review ? (
              <Paragraph type="secondary" style={{ marginBottom: 8 }} className="lesson-player-page__meta">
                Проверка работы: {review.studentNickname}
              </Paragraph>
            ) : null}
            {bootstrap?.studentSummary && !isTeacherReview ? (
              <Paragraph type="secondary" style={{ marginBottom: 8 }} className="lesson-player-page__meta">
                {bootstrap.studentSummary}
              </Paragraph>
            ) : null}
            <Space wrap className="lesson-player-page__head-actions">
              {isTeacherReview ? (
                <Link to="/teacher">Назад в кабинет</Link>
              ) : (
                <Link to="/learning">Назад</Link>
              )}
            </Space>
          </div>
          {/* Для школьных учеников убираем верхний блок «Задание: …», чтобы не дублировать контекст ДЗ. */}
          {bootstrap?.assignmentTitle && !(user?.role === "student" && user.studentMode === "school") ? (
            <Alert
              className="lesson-player-page__assignment-alert"
              type="info"
              showIcon
              message={`Задание: ${bootstrap.assignmentTitle}`}
              description="Прогресс сохраняется в контексте этого задания."
            />
          ) : null}
          {!bootstrap && !loading ? (
            <Card>Не удалось загрузить урок.</Card>
          ) : bootstrap ? (
            <>
              {flowBlocks.length === 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message="Урок пока без блоков"
                  description="Администратору нужно добавить блоки в конструкторе или заполнить JSON материалов."
                />
              ) : null}
              <LessonFlowView
                lessonId={lessonId}
                blocks={flowBlocks}
                checkpointOk={checkpointsOk}
                miniDevDone={miniDevDone}
                miniDevProjectId={miniDevProjectId}
                miniDevCreating={(id) => Boolean(autoCreatingMini[id])}
                draftAnswers={draftAnswers}
                onDraftChange={(id, v) => setDraftAnswers((d) => ({ ...d, [id]: v }))}
                onVerifyCheckpoint={(id, exp) => void verifyCheckpoint(id, exp)}
                onToggleMiniDevDone={(id) => void toggleMiniDevDone(id)}
                onEnsureMiniDevProject={(id) => void ensureMiniDevProject(id)}
                saving={saving}
                bareMiniStudio
                variant="colab"
                readOnly={isTeacherReview}
                teacherReviewSubmissionId={isTeacherReview ? reviewSubmissionId ?? undefined : undefined}
              />
              {allCheckpointsDone && checkpointBlockIds.length > 0 && !isTeacherReview ? (
                <Alert className="lesson-player-page__checkpoint-status" type="success" showIcon message="Все вопросы пройдены" />
              ) : null}
              {showSubmitToTeacher && submission ? (
                <Card title="Сдача работы" className="lesson-player-page__submit-card">
                  {submission.canSubmit ? (
                    <Space direction="vertical">
                      <Paragraph style={{ marginBottom: 0 }}>
                        Когда всё готово, отправь работу учителю на проверку.
                      </Paragraph>
                      <Button type="primary" loading={submittingToTeacher} onClick={() => void submitToTeacher()}>
                        Сдать учителю
                      </Button>
                    </Space>
                  ) : submission.status === "submitted" || submission.status === "pending_teacher_review" ? (
                    <Alert type="info" showIcon message="Работа отправлена учителю" />
                  ) : submission.status === "graded" ? (
                    <Alert type="success" showIcon message="Работа проверена" />
                  ) : (
                    <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      Сдать работу сейчас нельзя (статус: {submission.status}).
                    </Paragraph>
                  )}
                </Card>
              ) : null}
              {isTeacherReview && review ? (
                <Card title="Оценка" className="lesson-player-page__grade-card">
                  <Form form={gradeForm} layout="vertical">
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
                            extra={`0…${review.maxScore}`}
                          >
                            <InputNumber min={0} max={review.maxScore} style={{ width: "100%" }} />
                          </Form.Item>
                        ) : null
                      }
                    </Form.Item>
                    <Form.Item name="comment" label="Комментарий для ученика">
                      <TextArea rows={3} placeholder="Необязательно при оценке, желательно при доработке" />
                    </Form.Item>
                    <Button type="primary" loading={grading} onClick={() => void submitGradeFromLesson()}>
                      Сохранить оценку
                    </Button>
                  </Form>
                </Card>
              ) : null}
            </>
          ) : null}
        </Space>
      </Spin>
    </Content>
  );
}
