import { lazy, Suspense, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Input, Progress, Radio, Space, Spin, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LessonContentBlock } from "@/shared/types/lessonContent";
import { resolveLessonMediaUrl } from "@/shared/lessonMediaUrl";
import { markdownWithCustomEmojiImages } from "@/shared/emojiMarkdown";
import { MiniStudioSessionStore, isStudioCta, studioLessonFrameSrc } from "@/components/LessonFlowView";

const LessonPdfReader = lazy(() =>
  import("@/components/LessonPdfReader").then((m) => ({ default: m.LessonPdfReader }))
);

const { Text, Title } = Typography;

type QuestScene = {
  id: string;
  title: string;
  blocks: LessonContentBlock[];
  checkpointIds: string[];
  studioIds: string[];
};

export type LessonQuestPlayerProps = {
  title?: string;
  lessonId?: string;
  blocks: LessonContentBlock[];
  checkpointOk: (blockId: string) => boolean;
  miniDevDone: (blockId: string) => boolean;
  miniDevProjectId: (blockId: string) => string | null;
  miniDevCreating?: (blockId: string) => boolean;
  draftAnswers: Record<string, string>;
  onDraftChange: (blockId: string, value: string) => void;
  onVerifyCheckpoint: (blockId: string, expected: string) => void;
  onToggleMiniDevDone: (blockId: string) => void;
  onEnsureMiniDevProject?: (blockId: string) => void;
  saving: boolean;
  readOnly?: boolean;
  teacherReviewSubmissionId?: string | null;
};

function normalizeLessonText(value: string): string {
  return String(value ?? "").replace(/\\n/g, "\n");
}

function headingFromTextBody(body: string): string | null {
  const normalized = normalizeLessonText(body);
  const m = normalized.match(/^\s{0,3}#{1,3}\s+(.+)$/m);
  return m?.[1]?.trim() ?? null;
}

function splitScenes(blocks: LessonContentBlock[]): QuestScene[] {
  const chunks: LessonContentBlock[][] = [];
  let current: LessonContentBlock[] = [];
  for (const block of blocks) {
    if (block.type === "divider") {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
      }
      continue;
    }
    current.push(block);
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks.map((sceneBlocks, idx) => {
    const title =
      sceneBlocks.find((b): b is Extract<LessonContentBlock, { type: "text" }> => b.type === "text" && Boolean(headingFromTextBody(b.body)))
        ? headingFromTextBody(
            sceneBlocks.find((b): b is Extract<LessonContentBlock, { type: "text" }> => b.type === "text" && Boolean(headingFromTextBody(b.body)))!
              .body
          ) ?? `Миссия ${idx + 1}`
        : `Миссия ${idx + 1}`;
    return {
      id: `scene_${idx + 1}`,
      title,
      blocks: sceneBlocks,
      checkpointIds: sceneBlocks.filter((b): b is Extract<LessonContentBlock, { type: "checkpoint" }> => b.type === "checkpoint").map((b) => b.id),
      studioIds: sceneBlocks.filter((b): b is Extract<LessonContentBlock, { type: "studio" }> => b.type === "studio").map((b) => b.id)
    };
  });
}

export function LessonQuestPlayer({
  title,
  lessonId,
  blocks,
  checkpointOk,
  miniDevDone,
  miniDevProjectId,
  miniDevCreating,
  draftAnswers,
  onDraftChange,
  onVerifyCheckpoint,
  onToggleMiniDevDone,
  onEnsureMiniDevProject,
  saving,
  readOnly = false,
  teacherReviewSubmissionId = null
}: LessonQuestPlayerProps) {
  const scenes = useMemo(() => splitScenes(blocks), [blocks]);
  const [sceneIndex, setSceneIndex] = useState(0);
  const safeIndex = Math.min(Math.max(0, sceneIndex), Math.max(0, scenes.length - 1));
  const scene = scenes[safeIndex];

  const sceneDone = (s: QuestScene): boolean =>
    s.checkpointIds.every((id) => checkpointOk(id)) && s.studioIds.every((id) => miniDevDone(id));

  const unlocked = (idx: number): boolean => {
    return idx >= 0 && idx < scenes.length;
  };

  const completedScenes = scenes.filter(sceneDone).length;
  const completionPct = scenes.length > 0 ? Math.round((completedScenes / scenes.length) * 100) : 0;

  const checkpointOrdinalById = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const s of scenes) {
      for (const b of s.blocks) {
        if (b.type === "checkpoint") {
          n += 1;
          m.set(b.id, n);
        }
      }
    }
    return m;
  }, [scenes]);

  const renderMarkdown = (value: string, className?: string) => (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {markdownWithCustomEmojiImages(normalizeLessonText(value))}
      </ReactMarkdown>
    </div>
  );

  const renderBlock = (block: LessonContentBlock) => {
    if (block.type === "text") {
      return (
        <div className="lesson-quest-player__card lesson-quest-player__card--text lesson-quest-player__card--material">
          {renderMarkdown(block.body, "lesson-quest-player__markdown")}
        </div>
      );
    }
    if (block.type === "media" || block.type === "image" || block.type === "pdf") {
      const kind = block.type === "media" ? block.kind : block.type;
      const url = block.url;
      const isHeroShot = kind === "image" && url.includes("iris-quest-hero");
      return (
        <div className="lesson-quest-player__card lesson-quest-player__card--media">
          {isHeroShot ? (
            <div className="lesson-quest-player__hero">
              <img className="lesson-quest-player__hero-bg" src={resolveLessonMediaUrl(url)} alt="" />
              <div className="lesson-quest-player__hero-scrim" aria-hidden />
              <img
                className="lesson-quest-player__hero-nodus"
                src={resolveLessonMediaUrl("/api/coach/talking.png")}
                alt="Нодус"
              />
            </div>
          ) : kind === "image" ? (
            <img
              className="lesson-quest-player__image"
              src={resolveLessonMediaUrl(url)}
              alt={block.caption ?? ""}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <Suspense
              fallback={
                <div className="lesson-quest-player__loading">
                  <Spin />
                </div>
              }
            >
              <LessonPdfReader src={block.url} caption={block.caption ?? null} />
            </Suspense>
          )}
          {block.caption ? <Text type="secondary">{block.caption}</Text> : null}
        </div>
      );
    }
    if (block.type === "checkpoint") {
      const ord = checkpointOrdinalById.get(block.id) ?? 1;
      const ok = checkpointOk(block.id);
      const answerMode = block.answerMode ?? "text";
      const options = (block.options ?? []).filter(Boolean);
      const raw = draftAnswers[block.id] ?? "";
      const selected = raw.split("||").map((s) => s.trim()).filter(Boolean);
      return (
        <div className="lesson-quest-player__card lesson-quest-player__card--checkpoint">
          <div className="lesson-quest-player__checkpoint-title">
            <Tag color="processing">Квест-задание</Tag>
            <strong>Вопрос {ord}</strong>
          </div>
          <div className="lesson-quest-player__checkpoint-q">{normalizeLessonText(block.question)}</div>
          {ok ? (
            <Tag color="success">Верно</Tag>
          ) : readOnly ? (
            <Tag>Без проверки</Tag>
          ) : (
            <Space direction="vertical" style={{ width: "100%" }}>
              {answerMode === "text" ? (
                <Input.TextArea rows={2} value={raw} onChange={(e) => onDraftChange(block.id, e.target.value)} />
              ) : null}
              {answerMode === "single" ? (
                <Radio.Group
                  value={selected[0] ?? ""}
                  options={options.map((o) => ({ label: o, value: o }))}
                  onChange={(e) => onDraftChange(block.id, String(e.target.value))}
                />
              ) : null}
              {answerMode === "multi" ? (
                <Checkbox.Group
                  value={selected}
                  options={options}
                  onChange={(values) => onDraftChange(block.id, values.map(String).join("||"))}
                />
              ) : null}
              <Button type="primary" loading={saving} onClick={() => void onVerifyCheckpoint(block.id, block.expectedAnswer)}>
                Проверить ответ
              </Button>
            </Space>
          )}
        </div>
      );
    }
    if (block.type === "studio") {
      const projectId = miniDevProjectId(block.id);
      const creating = miniDevCreating?.(block.id) ?? false;
      const frameSrc = projectId
        ? studioLessonFrameSrc(projectId, block.id, {
            lessonId,
            teacherReviewId: teacherReviewSubmissionId ?? null,
            readOnly
          })
        : "";
      return (
        <div className="lesson-quest-player__card lesson-quest-player__card--studio">
          {renderMarkdown(block.instruction, "lesson-quest-player__markdown")}
          <MiniStudioSessionStore lessonId={lessonId} blockId={block.id} instruction={block.instruction} goals={block.goals ?? []} />
          {projectId ? (
            <iframe className="lesson-quest-player__mini-frame" title={`mini-dev-${block.id}`} src={frameSrc} />
          ) : creating ? (
            <div className="lesson-quest-player__loading">
              <Spin />
              <Text type="secondary">Открываем мини-разработку…</Text>
            </div>
          ) : (
            <Button type="primary" onClick={() => onEnsureMiniDevProject?.(block.id)} disabled={!onEnsureMiniDevProject || readOnly}>
              Запустить мини-разработку
            </Button>
          )}
          {!readOnly ? (
            <Button type={miniDevDone(block.id) ? "default" : "primary"} onClick={() => onToggleMiniDevDone(block.id)}>
              {miniDevDone(block.id) ? "Отмечено выполненным" : "Отметить как выполнено"}
            </Button>
          ) : null}
          {isStudioCta(block.ctaAction) ? <Text type="secondary">Блок Studio подключен к миссии.</Text> : null}
        </div>
      );
    }
    return null;
  };

  if (!scene) {
    return <Alert type="warning" showIcon message="В квесте пока нет миссий" />;
  }

  return (
    <div className="lesson-quest-player">
      <aside className="lesson-quest-player__map">
        <div className="lesson-quest-player__map-head">
          <img src="/api/coach/talking.png" alt="Нодус" className="lesson-quest-player__coach" />
          <div>
            <Title level={5} style={{ margin: 0 }}>
              {title ?? "Квест по ИИ"}
            </Title>
            <Text type="secondary">Нодус — твой ментор в Архиве</Text>
          </div>
        </div>
        <div className="lesson-quest-player__case-meta">
          <Tag color="error">Archive Incident</Tag>
          <Text type="secondary">Стажировка детектива данных</Text>
        </div>
        <Progress percent={completionPct} size="small" />
        <Space direction="vertical" style={{ width: "100%" }} size="small">
          {scenes.map((s, idx) => {
            const done = sceneDone(s);
            const canOpen = unlocked(idx);
            const active = idx === safeIndex;
            return (
              <button
                key={s.id}
                type="button"
                className={`lesson-quest-player__node${active ? " lesson-quest-player__node--active" : ""}`}
                disabled={!canOpen}
                onClick={() => setSceneIndex(idx)}
              >
                <span className="lesson-quest-player__node-index">{idx + 1}</span>
                <span className="lesson-quest-player__node-title">{s.title}</span>
                <Tag color={done ? "success" : canOpen ? "processing" : "default"}>{done ? "Закрыто" : "Дело"}</Tag>
              </button>
            );
          })}
        </Space>
      </aside>
      <section className="lesson-quest-player__stage">
        <Card className="lesson-quest-player__stage-head">
          <Space wrap>
            <Tag color="blue">Миссия {safeIndex + 1}</Tag>
            <Text strong>{scene.title}</Text>
            <Tag color={sceneDone(scene) ? "success" : "processing"}>{sceneDone(scene) ? "Миссия выполнена" : "В процессе"}</Tag>
          </Space>
        </Card>
        <div className="lesson-quest-player__blocks">
          {scene.blocks.map((block) => (
            <div key={block.id}>{renderBlock(block)}</div>
          ))}
        </div>
        <Card className="lesson-quest-player__stage-actions">
          <Space>
            <Button disabled={safeIndex <= 0} onClick={() => setSceneIndex((v) => Math.max(0, v - 1))}>
              Назад
            </Button>
            <Button
              type="primary"
              disabled={safeIndex >= scenes.length - 1}
              onClick={() => setSceneIndex((v) => Math.min(scenes.length - 1, v + 1))}
            >
              Следующая миссия
            </Button>
          </Space>
        </Card>
      </section>
    </div>
  );
}
