import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Card, Layout, Space, Spin, Typography, message } from "antd";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { createStudioProjectFromLessonTemplate } from "@/hooks/useOpenLessonTemplate";

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
  const navigate = useNavigate();
  const { lessonId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const assignmentId = searchParams.get("assignmentId");
  const [messageApi, holder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [playerState, setPlayerState] = useState<LessonPlayerStateV1>({ v: 1, checkpoints: {} });
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [openingStudio, setOpeningStudio] = useState(false);

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

  const openStudio = async () => {
    if (!bootstrap) {
      return;
    }
    setOpeningStudio(true);
    try {
      const projectId = await createStudioProjectFromLessonTemplate({
        id: lessonId,
        title: bootstrap.title
      });
      navigate(`/studio?project=${encodeURIComponent(projectId)}`);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось открыть Studio");
    } finally {
      setOpeningStudio(false);
    }
  };

  if (!user) {
    return (
      <Content className="app-content">
        <Card>
          <Link to="/">На главную</Link>
        </Card>
      </Content>
    );
  }

  if (user.role !== "student") {
    return (
      <Content className="app-content">
        <Card title="Плеер урока">
          <Paragraph>Интерактивное прохождение доступно ученикам.</Paragraph>
          <Link to="/">На главную</Link>
        </Card>
      </Content>
    );
  }

  const checkpointsOk = (blockId: string) => playerState.checkpoints?.[blockId] === "ok";

  const verifyCheckpoint = async (blockId: string, expected: string) => {
    const raw = draftAnswers[blockId] ?? "";
    if (normalizeCheckpointAnswer(raw) !== normalizeCheckpointAnswer(expected)) {
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

  return (
    <Content className="app-content lesson-player-page">
      {holder}
      <Spin spinning={loading}>
        <Space direction="vertical" size="large" style={{ width: "100%", maxWidth: 960, margin: "0 auto" }}>
          <div>
            <Title level={4} style={{ marginTop: 0 }}>
              {bootstrap?.title ?? "Урок"}
            </Title>
            {bootstrap?.studentSummary ? (
              <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                {bootstrap.studentSummary}
              </Paragraph>
            ) : null}
            <Space wrap>
              <Link to="/learning">Каталог</Link>
              <Link to="/class">Класс</Link>
            </Space>
          </div>
          {bootstrap?.assignmentTitle ? (
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
                draftAnswers={draftAnswers}
                onDraftChange={(id, v) => setDraftAnswers((d) => ({ ...d, [id]: v }))}
                onVerifyCheckpoint={(id, exp) => void verifyCheckpoint(id, exp)}
                saving={saving}
                onOpenStudio={() => void openStudio()}
                openingStudio={openingStudio}
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
