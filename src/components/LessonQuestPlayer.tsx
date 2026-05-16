import { lazy, Suspense, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  /** Краткая строка под названием в боковой колонке квеста (например studentSummary). */
  summary?: string | null;
  /** Ссылка из квеста в хаб (верхняя шапка урока скрыта). */
  hubNav?: { to: string; label: string } | null;
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

/** Детерминированная перетасовка вариантов: порядок стабилен для блока, но верный ответ не «всегда первый». */
function optionShuffleSeed(blockId: string, options: string[]): number {
  const key = `${blockId}\x1e${options.join("\x1e")}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

function shuffledStringsStable(blockId: string, options: string[]): string[] {
  const arr = [...options];
  if (arr.length <= 1) {
    return arr;
  }
  let s = optionShuffleSeed(blockId, options);
  for (let i = arr.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
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
  summary,
  hubNav,
  lessonId,
  blocks,
  checkpointOk,
  miniDevDone,
  miniDevProjectId,
  miniDevCreating,
  draftAnswers,
  onDraftChange,
  onVerifyCheckpoint,
  onToggleMiniDevDone: _onToggleMiniDevDone,
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
      /** Фон локации + Нодус поверх (агентство, оранжерея, досье, финал). */
      const isLabWithNodus =
        kind === "image" &&
        (url.includes("iris-quest-hero") ||
          url.includes("iris-quest-finale") ||
          url.includes("nodus-agency-hall") ||
          url.includes("iris-quest-greenhouse") ||
          url.includes("iris-quest-dossier"));
      const nodusOverlayUrl = url.includes("greenhouse")
        ? "/api/coach/working.png"
        : url.includes("finale")
          ? "/api/coach/success.png"
          : url.includes("dossier")
            ? "/api/coach/talking.png"
            : "/api/coach/idle.png";
      const diagramMat =
        kind === "image" &&
        (url.includes("iris-quest-dataset-split") || url.includes("iris-quest-overfit"));
      return (
        <div
          className={`lesson-quest-player__card lesson-quest-player__card--media${
            diagramMat ? " lesson-quest-player__card--diagram-mat" : ""
          }`}
        >
          {isLabWithNodus ? (
            <div className="lesson-quest-player__lab-scene">
              <img
                className="lesson-quest-player__image lesson-quest-player__image--in-lab"
                src={resolveLessonMediaUrl(url)}
                alt={block.caption ?? ""}
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <div className="lesson-quest-player__lab-scrim" aria-hidden />
              <img
                className="lesson-quest-player__lab-nodus"
                src={resolveLessonMediaUrl(nodusOverlayUrl)}
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
          {block.caption ? <p className="lesson-quest-player__media-caption">{block.caption}</p> : null}
        </div>
      );
    }
    if (block.type === "checkpoint") {
      const ord = checkpointOrdinalById.get(block.id) ?? 1;
      const ok = checkpointOk(block.id);
      const answerMode = block.answerMode ?? "text";
      const options = (block.options ?? []).filter(Boolean);
      const displayOptions = shuffledStringsStable(block.id, options);
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
                  options={displayOptions.map((o) => ({ label: o, value: o }))}
                  onChange={(e) => onDraftChange(block.id, String(e.target.value))}
                />
              ) : null}
              {answerMode === "multi" ? (
                <Checkbox.Group
                  value={selected}
                  options={displayOptions}
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
          {renderMarkdown(block.instruction, "lesson-quest-player__markdown lesson-quest-player__markdown--studio")}
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
          {projectId && (block.goals?.length ?? 0) > 0 ? (
            <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
              Когда все цели в мини-студии выполнены, шаг засчитывается сам — кнопка «готово» не нужна.
            </Text>
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
          <div>
            <Title level={5} style={{ margin: 0 }}>
              {title ?? "Квест по ИИ"}
            </Title>
            <Text type="secondary">{summary?.trim() || "Следуй шагам миссий."}</Text>
            {hubNav ? (
              <div style={{ marginTop: 6 }}>
                <Link to={hubNav.to}>{hubNav.label}</Link>
              </div>
            ) : null}
          </div>
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
