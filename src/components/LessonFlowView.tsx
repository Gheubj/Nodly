import { Button, Input, Space, Tag, Typography } from "antd";
import type { LessonContentBlock } from "@/shared/types/lessonContent";
import { pdfEmbedUrl, resolveLessonMediaUrl } from "@/shared/lessonMediaUrl";

const { Paragraph, Text } = Typography;

function isStudioCta(cta: string | null | undefined): boolean {
  if (!cta) {
    return false;
  }
  const s = cta.toLowerCase();
  return s.includes("studio") || s === "open_studio";
}

export type LessonFlowViewProps = {
  blocks: LessonContentBlock[];
  checkpointOk: (blockId: string) => boolean;
  miniDevDone: (blockId: string) => boolean;
  draftAnswers: Record<string, string>;
  onDraftChange: (blockId: string, value: string) => void;
  onVerifyCheckpoint: (blockId: string, expected: string) => void;
  onToggleMiniDevDone: (blockId: string) => void;
  saving: boolean;
};

export function LessonFlowView({
  blocks,
  checkpointOk,
  miniDevDone,
  draftAnswers,
  onDraftChange,
  onVerifyCheckpoint,
  onToggleMiniDevDone,
  saving
}: LessonFlowViewProps) {
  let checkpointOrdinal = 0;

  return (
    <div className="lesson-flow">
      {blocks.map((block) => {
        if (block.type === "divider") {
          return <div key={block.id} className="lesson-flow__divider" role="separator" />;
        }
        if (block.type === "text") {
          return (
            <div key={block.id} className="lesson-flow__segment lesson-flow__text">
              <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{block.body}</Paragraph>
            </div>
          );
        }
        if (block.type === "image") {
          return (
            <div key={block.id} className="lesson-flow__segment">
              <img
                className="lesson-flow__image"
                src={resolveLessonMediaUrl(block.url)}
                alt={block.caption ?? ""}
              />
              {block.caption ? (
                <div className="lesson-flow__text">
                  <Text type="secondary">{block.caption}</Text>
                </div>
              ) : null}
            </div>
          );
        }
        if (block.type === "pdf") {
          return (
            <div key={block.id} className="lesson-flow__segment">
              {block.caption ? (
                <div className="lesson-flow__text" style={{ borderBottom: "1px solid var(--ant-color-border)" }}>
                  <Text strong>{block.caption}</Text>
                </div>
              ) : null}
              <iframe
                className="lesson-flow__pdf"
                title={block.caption ?? "PDF"}
                src={pdfEmbedUrl(block.url)}
              />
            </div>
          );
        }
        if (block.type === "studio") {
          return (
            <div key={block.id} className="lesson-flow__segment lesson-flow__studio">
              <Paragraph style={{ marginBottom: 8 }}>
                <Text strong>{block.title}</Text>
              </Paragraph>
              <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>{block.instruction}</Paragraph>
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                <Input.TextArea rows={3} placeholder="Заметка ученика по мини-разработке (необязательно)" />
                <Button type={miniDevDone(block.id) ? "default" : "primary"} onClick={() => onToggleMiniDevDone(block.id)}>
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
          return (
            <div key={block.id} className="lesson-flow__segment lesson-flow__checkpoint">
              <Paragraph style={{ marginBottom: 8 }}>
                <Text strong>
                  Вопрос {checkpointOrdinal}: {block.question}
                </Text>
              </Paragraph>
              {ok ? (
                <Tag color="success">Верно</Tag>
              ) : (
                <Space direction="vertical" style={{ width: "100%" }} size="small">
                  <Input.TextArea
                    rows={2}
                    placeholder="Ответ"
                    value={draftAnswers[block.id] ?? ""}
                    onChange={(e) => onDraftChange(block.id, e.target.value)}
                  />
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
