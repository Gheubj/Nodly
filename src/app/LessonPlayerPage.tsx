import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Card, Layout, Space, Spin, Typography, message } from "antd";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
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

type Bootstrap = {
  title: string;
  studentSummary: string | null;
  lessonContent: unknown;
  scopeKey: string;
  assignmentTitle: string | null;
  state: unknown;
};

export function LessonPlayerPage() {
  const { user } = useSessionStore();
  const { lessonId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const assignmentId = searchParams.get("assignmentId");
  const [messageApi, holder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [playerState, setPlayerState] = useState<LessonPlayerStateV1>({ v: 1, checkpoints: {} });
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [autoCreatingMini, setAutoCreatingMini] = useState<Record<string, boolean>>({});

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
  const studioBlockIds = useMemo(
    () => flowBlocks.filter((b): b is Extract<(typeof flowBlocks)[0], { type: "studio" }> => b.type === "studio").map((b) => b.id),
    [flowBlocks]
  );

  const persistState = useCallback(
    async (next: LessonPlayerStateV1) => {
      const q = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : "";
      setSaving(true);
      try {
        await apiClient.patch(`/api/student/lessons/${encodeURIComponent(lessonId)}/player-progress${q}`, {
          state: next
        });
        setPlayerState(next);
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : "Не удалось сохранить прогресс");
      } finally {
        setSaving(false);
      }
    },
    [assignmentId, lessonId, messageApi]
  );

  const load = useCallback(async () => {
    if (!lessonId) {
      return;
    }
    setLoading(true);
    try {
      const q = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : "";
      const data = await apiClient.get<Bootstrap>(
        `/api/student/lessons/${encodeURIComponent(lessonId)}/player-bootstrap${q}`
      );
      setBootstrap(data);
      setPlayerState(parseLessonPlayerState(data.state));
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось загрузить урок");
      setBootstrap(null);
    } finally {
      setLoading(false);
    }
  }, [assignmentId, lessonId, messageApi]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) {
    return (
      <Content className="app-content">
        <Card>
          <Link to="/">На главную</Link>
        </Card>
      </Content>
    );
  }

  if (user.role !== "student" && user.role !== "admin") {
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
  const miniDevProjectId = (blockId: string) => playerState.miniDevProjectIds?.[blockId] ?? null;

  const verifyCheckpoint = async (blockId: string, expected: string) => {
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
    const next: LessonPlayerStateV1 = {
      ...playerState,
      miniDevDone: {
        ...(playerState.miniDevDone ?? {}),
        [blockId]: !miniDevDone(blockId)
      }
    };
    await persistState(next);
  };

  const ensureMiniDevProject = async (blockId: string) => {
    if (!bootstrap) {
      return;
    }
    if (miniDevProjectId(blockId)) {
      return;
    }
    if (autoCreatingMini[blockId]) {
      return;
    }
    setAutoCreatingMini((prev) => ({ ...prev, [blockId]: true }));
    setSaving(true);
    try {
      const q = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : "";
      const { projectId } = await apiClient.post<{ projectId: string }>(
        `/api/student/lessons/${encodeURIComponent(lessonId)}/mini-dev-project${q}`,
        {
          blockId,
          title: `${bootstrap.title} · мини-${blockId.slice(0, 6)}`
        }
      );
      const next: LessonPlayerStateV1 = {
        ...playerState,
        miniDevProjectIds: {
          ...(playerState.miniDevProjectIds ?? {}),
          [blockId]: projectId
        }
      };
      await persistState(next);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось запустить мини-разработку");
      setSaving(false);
    } finally {
      setAutoCreatingMini((prev) => ({ ...prev, [blockId]: false }));
    }
  };

  useEffect(() => {
    if (!bootstrap) {
      return;
    }
    const missing = studioBlockIds.filter((id) => !miniDevProjectId(id));
    if (missing.length === 0) {
      return;
    }
    void (async () => {
      for (const id of missing) {
        await ensureMiniDevProject(id);
      }
    })();
  }, [bootstrap?.title, studioBlockIds.join("|"), JSON.stringify(playerState.miniDevProjectIds ?? {})]);

  return (
    <Content className="app-content app-content--workspace lesson-player-page">
      {holder}
      <Spin spinning={loading}>
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <div className="lesson-player-page__head">
            <Title level={4} style={{ marginTop: 0 }}>
              {bootstrap?.title ?? "Урок"}
            </Title>
            {bootstrap?.studentSummary ? (
              <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                {bootstrap.studentSummary}
              </Paragraph>
            ) : null}
            <Space wrap>
              <Link to="/learning">Назад</Link>
            </Space>
          </div>
          {/* Для школьных учеников убираем верхний блок «Задание: …», чтобы не дублировать контекст ДЗ. */}
          {bootstrap?.assignmentTitle && !(user?.role === "student" && user.studentMode === "school") ? (
            <Alert
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
                blocks={flowBlocks}
                checkpointOk={checkpointsOk}
                miniDevDone={miniDevDone}
                miniDevProjectId={miniDevProjectId}
                draftAnswers={draftAnswers}
                onDraftChange={(id, v) => setDraftAnswers((d) => ({ ...d, [id]: v }))}
                onVerifyCheckpoint={(id, exp) => void verifyCheckpoint(id, exp)}
                onToggleMiniDevDone={(id) => void toggleMiniDevDone(id)}
                saving={saving}
                bareMiniStudio
                variant="colab"
              />
              {allCheckpointsDone && checkpointBlockIds.length > 0 ? (
                <Alert type="success" showIcon message="Все контрольные вопросы пройдены" />
              ) : null}
            </>
          ) : null}
        </Space>
      </Spin>
    </Content>
  );
}
