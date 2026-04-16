import type { ReactNode } from "react";
import { Button, Card, Collapse, Space, Typography } from "antd";
import type { LessonContent } from "@/shared/types/lessonContent";
import { pdfEmbedUrl, resolveLessonMediaUrl } from "@/shared/lessonMediaUrl";

const { Text, Paragraph } = Typography;

export type LessonContentMaterialsProps = {
  lessonTitle: string;
  studentSummary: string | null;
  lessonContent: LessonContent;
  /** Дополнительный блок внизу (например кнопки задания) */
  footer?: ReactNode;
  /** Показывать ожидаемый ответ у контрольных вопросов (только превью для учителя/класса) */
  showCheckpointAnswers?: boolean;
  /** Скрыть секцию контрольных вопросов (плеер покажет их отдельно) */
  showCheckpointsSection?: boolean;
};

export function LessonContentMaterials({
  lessonTitle,
  studentSummary,
  lessonContent,
  footer,
  showCheckpointAnswers = true,
  showCheckpointsSection = true
}: LessonContentMaterialsProps) {
  const c = lessonContent;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title={lessonTitle}>
        {studentSummary ? (
          <Paragraph style={{ marginBottom: 0 }}>{studentSummary}</Paragraph>
        ) : (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Краткое описание урока пока не добавлено.
          </Paragraph>
        )}
      </Card>
      <Card title="Материалы урока">
        {c.presentationPdfUrl ? (
          <Card size="small" title="Презентация (PDF)" style={{ marginBottom: 12 }}>
            <Space direction="vertical" size="small" style={{ width: "100%" }}>
              <Button
                type="default"
                onClick={() => window.open(pdfEmbedUrl(c.presentationPdfUrl), "_blank", "noreferrer")}
              >
                Открыть презентацию PDF
              </Button>
              <iframe
                src={pdfEmbedUrl(c.presentationPdfUrl)}
                className="lesson-flow__pdf"
                title={`PDF: ${lessonTitle}`}
                style={{ width: "100%", minHeight: 420, border: "1px solid var(--ant-color-border)" }}
              />
            </Space>
          </Card>
        ) : null}
        {c.slides.length === 0 ? (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Слайды пока не заполнены.
          </Paragraph>
        ) : (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {c.slides.map((slide, idx) => (
              <Card key={`slide-${idx}`} size="small" title={`Слайд ${idx + 1}: ${slide.title}`}>
                <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{slide.body}</Paragraph>
                {slide.mediaUrl ? (
                  <Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                    Материал:{" "}
                    <a href={resolveLessonMediaUrl(slide.mediaUrl)} target="_blank" rel="noreferrer">
                      открыть ссылку
                    </a>
                  </Paragraph>
                ) : null}
              </Card>
            ))}
          </Space>
        )}
      </Card>
      <Card title="Практика по шагам">
        {c.practiceSteps.length === 0 ? (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Практические шаги не заполнены.
          </Paragraph>
        ) : (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {c.practiceSteps.map((step, idx) => (
              <Card key={`step-${idx}`} size="small" title={`Шаг ${idx + 1}: ${step.title}`}>
                <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{step.instruction}</Paragraph>
                {step.ctaAction ? (
                  <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }} code>
                    Действие: {step.ctaAction}
                  </Paragraph>
                ) : null}
              </Card>
            ))}
          </Space>
        )}
      </Card>
      {showCheckpointsSection ? (
        <Card title="Проверка понимания">
          {c.checkpoints.length === 0 ? (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Контрольные вопросы не добавлены.
            </Paragraph>
          ) : (
            <Space direction="vertical" size="small" style={{ width: "100%" }}>
              {c.checkpoints.map((checkpoint, idx) => (
                <Card key={`checkpoint-${idx}`} size="small">
                  <Paragraph style={{ marginBottom: 8 }}>
                    <Text strong>
                      {idx + 1}. {checkpoint.question}
                    </Text>
                  </Paragraph>
                  {showCheckpointAnswers ? (
                    <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      Ожидаемый ответ: {checkpoint.expectedAnswer}
                    </Paragraph>
                  ) : (
                    <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      Ответ проверяется в интерактивном прохождении урока.
                    </Paragraph>
                  )}
                </Card>
              ))}
            </Space>
          )}
        </Card>
      ) : null}
      <Card title="Помощник">
        {c.hints.length === 0 ? (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Пока нет подсказок для этого урока.
          </Paragraph>
        ) : (
          <Collapse
            size="small"
            items={c.hints.map((hint, idx) => ({
              key: String(idx),
              label: hint.title,
              children: <Paragraph style={{ marginBottom: 0 }}>{hint.text}</Paragraph>
            }))}
          />
        )}
      </Card>
      {footer ? <Card title="Действия по уроку">{footer}</Card> : null}
    </Space>
  );
}
