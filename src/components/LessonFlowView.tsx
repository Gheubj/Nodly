import { lazy, Suspense, useLayoutEffect } from "react";
import { Button, Checkbox, Input, Radio, Space, Spin, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LessonContentBlock } from "@/shared/types/lessonContent";
import { resolveLessonMediaUrl } from "@/shared/lessonMediaUrl";

const LessonPdfReader = lazy(() =>
  import("@/components/LessonPdfReader").then((m) => ({ default: m.LessonPdfReader }))
);

const { Paragraph, Text } = Typography;

const MINI_PREVIEW_LESSON_KEY = "_preview";

function miniLessonStorageKey(lessonId: string | undefined, blockId: string): string {
  const lid = lessonId?.trim() ? lessonId.trim() : MINI_PREVIEW_LESSON_KEY;
  return `nodly_mini_ctx__${lid}__${blockId}`;
}

/** Кладёт инструкцию и цели в sessionStorage (тот же ключ, что в URL iframe) + дубли для postMessage в StudioPage. */
function MiniStudioSessionStore(props: {
  lessonId?: string;
  blockId: string;
  instruction: string;
  goals: NonNullable<Extract<LessonContentBlock, { type: "studio" }>["goals"]>;
}) {
  useLayoutEffect(() => {
    try {
      sessionStorage.setItem(
        miniLessonStorageKey(props.lessonId, props.blockId),
        JSON.stringify({ instruction: props.instruction, goals: props.goals })
      );
    } catch {
      /* ignore */
    }
  }, [props.lessonId, props.blockId, props.instruction, props.goals]);
  return null;
}

/** Отправляет контекст в iframe: sessionStorage в дочернем контексте часто не совпадает с родителем (partitioned storage). */
function postMiniBootstrapToFrame(
  win: Window | null | undefined,
  payload: {
    lessonId: string;
    blockId: string;
    instruction: string;
    goals: NonNullable<Extract<LessonContentBlock, { type: "studio" }>["goals"]>;
  }
) {
  if (!win) {
    return;
  }
  const msg = {
    source: "nodly-mini-bootstrap" as const,
    lessonId: payload.lessonId,
    blockId: payload.blockId,
    instruction: payload.instruction,
    goals: payload.goals
  };
  const origin = window.location.origin;
  const send = () => {
    try {
      win.postMessage(msg, origin);
    } catch {
      /* ignore */
    }
  };
  send();
  window.setTimeout(send, 120);
  window.setTimeout(send, 400);
}

function isStudioCta(cta: string | null | undefined): boolean {
  if (!cta) {
    return false;
  }
  const s = cta.toLowerCase();
  return s.includes("studio") || s === "open_studio";
}

export type LessonFlowViewProps = {
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
  bareMiniStudio?: boolean;
  variant?: "classic" | "colab";
};

export function LessonFlowView({
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
  bareMiniStudio = false,
  variant = "classic"
}: LessonFlowViewProps) {
  let checkpointOrdinal = 0;
  const isColab = variant === "colab";

  const renderMarkdown = (value: string, className?: string) => (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
    </div>
  );

  const renderMedia = (block: Extract<LessonContentBlock, { type: "media" | "image" | "pdf" }>) => {
    const mediaKind = block.type === "media" ? block.kind : block.type;
    const caption = block.caption ?? "";
    if (mediaKind === "image") {
      return (
        <div key={block.id} className={`lesson-flow__segment${isColab ? " lesson-flow__segment--colab" : ""}`}>
          <img className="lesson-flow__image" src={resolveLessonMediaUrl(block.url)} alt={caption} />
          {caption ? <div className="lesson-flow__text"><Text type="secondary">{caption}</Text></div> : null}
        </div>
      );
    }
    return (
      <div key={block.id} className={`lesson-flow__segment${isColab ? " lesson-flow__segment--colab" : ""}`}>
        {caption ? (
          <div className="lesson-flow__text" style={{ borderBottom: "1px solid var(--ant-color-border)" }}>
            <Text strong>{caption}</Text>
          </div>
        ) : null}
        <Suspense
          fallback={
            <div className="lesson-flow__pdf-reader-loading">
              <Spin />
            </div>
          }
        >
          <LessonPdfReader src={block.url} caption={caption || null} />
        </Suspense>
      </div>
    );
  };

  return (
    <div className={`lesson-flow${isColab ? " lesson-flow--colab" : ""}`}>
      {blocks.map((block) => {
        if (block.type === "divider") {
          return null;
        }
        if (block.type === "text") {
          return (
            <div key={block.id} className={`lesson-flow__segment lesson-flow__text${isColab ? " lesson-flow__segment--colab" : ""}`}>
              {renderMarkdown(block.body, "lesson-flow__markdown")}
            </div>
          );
        }
        if (block.type === "media" || block.type === "image" || block.type === "pdf") {
          return renderMedia(block);
        }
        if (block.type === "studio") {
          const projectId = miniDevProjectId(block.id);
          const creating = miniDevCreating?.(block.id) ?? false;
          const miniLessonKey = lessonId?.trim() ? lessonId.trim() : MINI_PREVIEW_LESSON_KEY;
          const frameSrc = projectId
            ? `/studio?mini=1&project=${encodeURIComponent(projectId)}&miniLessonId=${encodeURIComponent(
                miniLessonKey
              )}&miniBlockId=${encodeURIComponent(block.id)}`
            : "";
          if (bareMiniStudio) {
            return (
              <div key={block.id}>
                <MiniStudioSessionStore
                  lessonId={lessonId}
                  blockId={block.id}
                  instruction={block.instruction}
                  goals={block.goals ?? []}
                />
                {projectId ? (
                  <iframe
                    className="lesson-flow__mini-dev-frame"
                    title={`mini-dev-${block.id}`}
                    src={frameSrc}
                    onLoad={(e) => {
                      const w = (e.target as HTMLIFrameElement).contentWindow;
                      postMiniBootstrapToFrame(w, {
                        lessonId: miniLessonKey,
                        blockId: block.id,
                        instruction: block.instruction,
                        goals: block.goals ?? []
                      });
                    }}
                  />
                ) : (
                  <Space direction="vertical" size="small">
                    <Text type="secondary">
                      Мини-разработка ещё не сохранена в проекты. Нажми кнопку, чтобы создать проект.
                    </Text>
                    <Button
                      type="primary"
                      loading={creating}
                      onClick={() => onEnsureMiniDevProject?.(block.id)}
                      disabled={!onEnsureMiniDevProject}
                    >
                      Сохранить мини-разработку
                    </Button>
                  </Space>
                )}
              </div>
            );
          }
          return (
            <div key={block.id} className={`lesson-flow__segment lesson-flow__studio${isColab ? " lesson-flow__segment--colab" : ""}`}>
              <div className="lesson-flow__studio-markdown">{renderMarkdown(block.instruction, "lesson-flow__markdown")}</div>
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                {projectId ? (
                  <iframe
                    className="lesson-flow__mini-dev-frame"
                    title={`mini-dev-${block.id}`}
                    src={frameSrc}
                    onLoad={(e) => {
                      const w = (e.target as HTMLIFrameElement).contentWindow;
                      postMiniBootstrapToFrame(w, {
                        lessonId: miniLessonKey,
                        blockId: block.id,
                        instruction: block.instruction,
                        goals: block.goals ?? []
                      });
                    }}
                  />
                ) : (
                  <Space direction="vertical" size="small">
                    <Text type="secondary">
                      Мини-разработка ещё не сохранена в проекты. Нажми кнопку, чтобы создать проект.
                    </Text>
                    <Button
                      type="primary"
                      loading={creating}
                      onClick={() => onEnsureMiniDevProject?.(block.id)}
                      disabled={!onEnsureMiniDevProject}
                    >
                      Сохранить мини-разработку
                    </Button>
                  </Space>
                )}
                <Button
                  type={miniDevDone(block.id) ? "default" : "primary"}
                  onClick={() => onToggleMiniDevDone(block.id)}
                >
                  {miniDevDone(block.id) ? "Отмечено выполненным" : "Отметить мини-разработку выполненной"}
                </Button>
                {isStudioCta(block.ctaAction) ? (
                  <Text type="secondary">Этот блок был импортирован из старого формата Studio и работает как мини-разработка.</Text>
                ) : null}
              </Space>
            </div>
          );
        }
        if (block.type === "checkpoint") {
          checkpointOrdinal += 1;
          const ok = checkpointOk(block.id);
          const answerMode = block.answerMode ?? "text";
          const options = (block.options ?? []).filter(Boolean);
          const raw = draftAnswers[block.id] ?? "";
          const selected = raw
            .split("||")
            .map((s) => s.trim())
            .filter(Boolean);
          return (
            <div key={block.id} className={`lesson-flow__segment lesson-flow__checkpoint${isColab ? " lesson-flow__segment--colab" : ""}`}>
              <Paragraph style={{ marginBottom: 8 }}>
                <Text strong>
                  Вопрос {checkpointOrdinal}: {block.question}
                </Text>
              </Paragraph>
              {ok ? (
                <Tag color="success">Верно</Tag>
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
      })}
    </div>
  );
}
