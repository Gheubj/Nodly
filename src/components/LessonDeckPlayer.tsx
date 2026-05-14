import { lazy, Suspense, useMemo, useState, type CSSProperties } from "react";
import { Alert, Button, Card, Checkbox, Input, Radio, Space, Spin, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LessonContentDeck, LessonContentBlock, LessonDeckElement } from "@/shared/types/lessonContent";
import { resolveLessonMediaUrl } from "@/shared/lessonMediaUrl";
import { markdownWithCustomEmojiImages } from "@/shared/emojiMarkdown";
import {
  MiniStudioSessionStore,
  isStudioCta,
  studioLessonFrameSrc
} from "@/components/LessonFlowView";

const LessonPdfReader = lazy(() =>
  import("@/components/LessonPdfReader").then((m) => ({ default: m.LessonPdfReader }))
);

const { Text } = Typography;

export type LessonDeckPlayerProps = {
  deck: LessonContentDeck;
  lessonId?: string;
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

function sortSlideElements(elements: LessonDeckElement[]): LessonDeckElement[] {
  return [...elements].sort((a, b) => {
    const za = a.zIndex ?? 0;
    const zb = b.zIndex ?? 0;
    if (za !== zb) {
      return za - zb;
    }
    return a.id.localeCompare(b.id);
  });
}

function normalizeLessonText(value: string): string {
  if (!value) {
    return "";
  }
  // В старых seed-уроках встречаются экранированные переносы "\\n".
  return value.replace(/\\n/g, "\n");
}

export function LessonDeckPlayer({
  deck,
  lessonId,
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
}: LessonDeckPlayerProps) {
  const slides = deck.slides ?? [];
  const [slideIndex, setSlideIndex] = useState(0);
  const safeIndex = Math.min(Math.max(0, slideIndex), Math.max(0, slides.length - 1));
  const slide = slides[safeIndex];
  const sortedElements = slide ? sortSlideElements(slide.elements) : [];

  const checkpointOrdinalByBlockId = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const s of slides) {
      for (const el of sortSlideElements(s.elements)) {
        if (el.block.type === "checkpoint") {
          n += 1;
          m.set(el.block.id, n);
        }
      }
    }
    return m;
  }, [slides]);

  const checkpointIds = useMemo(() => [...checkpointOrdinalByBlockId.keys()], [checkpointOrdinalByBlockId]);
  const solvedCheckpoints = useMemo(
    () => checkpointIds.filter((id) => checkpointOk(id)).length,
    [checkpointIds, checkpointOk]
  );

  const renderMarkdown = (value: string, className?: string) => (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {markdownWithCustomEmojiImages(normalizeLessonText(value))}
      </ReactMarkdown>
    </div>
  );

  const renderMedia = (block: Extract<LessonContentBlock, { type: "media" | "image" | "pdf" }>) => {
    const mediaKind = block.type === "media" ? block.kind : block.type;
    const caption = block.caption ?? "";
    if (mediaKind === "image") {
      return (
        <div className="lesson-deck-player__segment lesson-deck-player__segment--media">
          <img className="lesson-deck-player__image" src={resolveLessonMediaUrl(block.url)} alt={caption} />
          {caption ? (
            <div className="lesson-deck-player__caption">
              <Text type="secondary">{caption}</Text>
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <div className="lesson-deck-player__segment lesson-deck-player__segment--media">
        {caption ? (
          <div className="lesson-deck-player__caption lesson-deck-player__caption--bordered">
            <Text strong>{caption}</Text>
          </div>
        ) : null}
        <Suspense
          fallback={
            <div className="lesson-deck-player__pdf-loading">
              <Spin />
            </div>
          }
        >
          <LessonPdfReader src={block.url} caption={caption || null} />
        </Suspense>
      </div>
    );
  };

  const renderBlock = (block: LessonContentBlock) => {
    if (block.type === "text") {
      const scale = block.textScale === "sm" || block.textScale === "lg" ? block.textScale : null;
      const mdClass = `lesson-deck-player__markdown${scale ? ` lesson-deck-player__markdown--text-${scale}` : ""}`;
      return (
        <div className="lesson-deck-player__segment lesson-deck-player__segment--text">
          {renderMarkdown(block.body, mdClass)}
        </div>
      );
    }
    if (block.type === "media" || block.type === "image" || block.type === "pdf") {
      return renderMedia(block);
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
        <div className="lesson-deck-player__segment lesson-deck-player__segment--studio">
          <MiniStudioSessionStore
            lessonId={lessonId}
            blockId={block.id}
            instruction={block.instruction}
            goals={block.goals ?? []}
          />
          {projectId ? (
            <iframe className="lesson-deck-player__mini-frame" title={`mini-dev-${block.id}`} src={frameSrc} />
          ) : creating ? (
            <div className="lesson-deck-player__mini-loading">
              <Spin />
              <Text type="secondary">Открываем мини-разработку…</Text>
            </div>
          ) : readOnly ? (
            <Text type="secondary">Нет сохранённого проекта в этом блоке.</Text>
          ) : (
            <Space direction="vertical" size="small">
              <Text type="secondary">Не удалось открыть мини-разработку.</Text>
              <Button type="primary" onClick={() => onEnsureMiniDevProject?.(block.id)} disabled={!onEnsureMiniDevProject}>
                Повторить
              </Button>
            </Space>
          )}
          {!readOnly ? (
            <Button type={miniDevDone(block.id) ? "default" : "primary"} onClick={() => onToggleMiniDevDone(block.id)}>
              {miniDevDone(block.id) ? "Отмечено выполненным" : "Отметить мини-разработку выполненной"}
            </Button>
          ) : null}
          {isStudioCta(block.ctaAction) ? (
            <Text type="secondary">Импортированный блок Studio — мини-разработка.</Text>
          ) : null}
        </div>
      );
    }
    if (block.type === "checkpoint") {
      const ord = checkpointOrdinalByBlockId.get(block.id) ?? 1;
      const ok = checkpointOk(block.id);
      const answerMode = block.answerMode ?? "text";
      const options = (block.options ?? []).filter(Boolean);
      const raw = draftAnswers[block.id] ?? "";
      const selected = raw
        .split("||")
        .map((s) => s.trim())
        .filter(Boolean);
      return (
        <div className="lesson-deck-player__segment lesson-deck-player__segment--checkpoint">
          <div className="lesson-deck-player__checkpoint-prompt">
            <strong>Вопрос {ord}:</strong> {normalizeLessonText(block.question)}
          </div>
          {ok ? (
            <Tag color="success">Верно</Tag>
          ) : readOnly ? (
            <Tag color="default">Нет отметки «верно»</Tag>
          ) : (
            <Space direction="vertical" style={{ width: "100%" }} size="small">
              {answerMode === "text" ? (
                <Input.TextArea
                  rows={2}
                  placeholder="Ответ"
                  value={raw}
                  onChange={(e) => onDraftChange(block.id, e.target.value)}
                />
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
              <Button loading={saving} onClick={() => void onVerifyCheckpoint(block.id, block.expectedAnswer)}>
                Проверить
              </Button>
            </Space>
          )}
        </div>
      );
    }
    return null;
  };

  if (!slide) {
    return <Alert type="warning" showIcon message="В деке нет слайдов" />;
  }

  const bg = slide.backgroundImageUrl?.trim();
  const stageStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    backgroundColor: "var(--ant-color-fill-quaternary, #f5f5f5)",
    ...(bg
      ? {
          backgroundImage: `url(${resolveLessonMediaUrl(bg)})`,
          backgroundSize: "cover",
          backgroundPosition: "center"
        }
      : {})
  };

  return (
    <div className="lesson-deck-player lesson-deck-player--fullscreen">
      <Card size="small" className="lesson-deck-player__nav lesson-deck-player__nav--quest">
        <Space wrap>
          <Button className="lesson-deck-player__nav-btn" disabled={safeIndex <= 0} onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}>
            Назад
          </Button>
          <Text type="secondary" className="lesson-deck-player__slide-counter">
            Слайд {safeIndex + 1} / {slides.length}
            {slide.title ? ` — ${slide.title}` : ""}
          </Text>
          <Tag color="processing">Квест</Tag>
          <Tag color={checkpointIds.length > 0 && solvedCheckpoints === checkpointIds.length ? "success" : "default"}>
            Миссии: {solvedCheckpoints}/{checkpointIds.length}
          </Tag>
          <Button className="lesson-deck-player__nav-btn" disabled={safeIndex >= slides.length - 1} onClick={() => setSlideIndex((i) => Math.min(slides.length - 1, i + 1))}>
            Далее
          </Button>
        </Space>
      </Card>
      <div className="lesson-deck-player__stage-wrap">
        <div className="lesson-deck-player__stage lesson-deck-player__stage--fullscreen" style={stageStyle}>
          {sortedElements.map((el) => (
            <div
              key={el.id}
              className="lesson-deck-player__abs"
              style={{
                left: `${el.layout.x}%`,
                top: `${el.layout.y}%`,
                width: `${el.layout.w}%`,
                height: `${el.layout.h}%`,
                zIndex: el.zIndex ?? 1
              }}
            >
              <div
                className={`lesson-deck-player__abs-inner lesson-deck-player__abs-inner--${el.block.type}`}
              >
                {renderBlock(el.block)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
