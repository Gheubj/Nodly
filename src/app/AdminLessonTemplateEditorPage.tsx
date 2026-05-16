import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Modal, Segmented, Space, Spin, Switch, Typography, message } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import { AdminLessonBlockEditor } from "@/components/AdminLessonBlockEditor";
import { AdminLessonDeckEditor } from "@/components/AdminLessonDeckEditor";
import {
  emptyLessonContentDeck,
  expandLessonContentToBlocks,
  flattenDeckToBlocks,
  lessonContentFromBlocks,
  lessonContentFromDeck,
  lessonHasRenderableDeck,
  linearBlocksToDeck
} from "@/shared/lessonContentBlocks";
import { EMPTY_LESSON_CONTENT, type LessonContent, type LessonContentBlock, type LessonContentDeck } from "@/shared/types/lessonContent";

const { Title, Text, Paragraph } = Typography;

type TemplateContentPayload = {
  id: string;
  title: string;
  moduleKey: string;
  sortOrder: number;
  description: string | null;
  published: boolean;
  studentSummary: string | null;
  lessonContent: unknown;
};

function parseLessonContent(raw: unknown): LessonContent {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_LESSON_CONTENT };
  }
  return { ...EMPTY_LESSON_CONTENT, ...(raw as LessonContent) };
}

export function AdminLessonTemplateEditorPage() {
  const { user } = useSessionStore();
  const navigate = useNavigate();
  const { templateId = "" } = useParams();
  const [messageApi, holder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<TemplateContentPayload | null>(null);
  const [blocks, setBlocks] = useState<LessonContentBlock[]>([]);
  const [deck, setDeck] = useState<LessonContentDeck>(emptyLessonContentDeck());
  const [editorMode, setEditorMode] = useState<"flow" | "deck">("flow");
  const [questLayout, setQuestLayout] = useState(false);

  const title = useMemo(() => template?.title ?? "Шаблон урока", [template?.title]);

  useEffect(() => {
    if (!templateId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const data = await apiClient.get<TemplateContentPayload>(
          `/api/admin/lesson-templates/${encodeURIComponent(templateId)}/content`
        );
        if (cancelled) {
          return;
        }
        setTemplate(data);
        const lc = parseLessonContent(data.lessonContent);
        const useDeck = lessonHasRenderableDeck(lc) && Boolean(lc.deck);
        setEditorMode(useDeck ? "deck" : "flow");
        setDeck(useDeck && lc.deck ? lc.deck : emptyLessonContentDeck());
        setBlocks(expandLessonContentToBlocks(lc));
        setQuestLayout(lc.questLayout === true);
      } catch (e) {
        if (!cancelled) {
          messageApi.error(e instanceof Error ? e.message : "Не удалось загрузить шаблон");
          setTemplate(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, messageApi]);

  const requestModeChange = (next: "flow" | "deck") => {
    if (next === editorMode) {
      return;
    }
    if (next === "deck") {
      Modal.confirm({
        title: "Режим слайдов",
        content:
          "Текущая лента будет преобразована в слайды (по несколько блоков на слайд). Продолжить?",
        okText: "Да",
        cancelText: "Отмена",
        onOk: () => {
          setDeck(linearBlocksToDeck(blocks));
          setEditorMode("deck");
          messageApi.success("Лента перенесена в дек. При необходимости подправьте раскладку.");
        }
      });
      return;
    }
    Modal.confirm({
      title: "Режим ленты",
      content:
        "Слайды будут свернуты в линейную ленту блоков (позиции на слайдах не сохранятся в этом режиме). Продолжить?",
      okText: "Да",
      cancelText: "Отмена",
      onOk: () => {
        setBlocks(flattenDeckToBlocks(deck));
        setEditorMode("flow");
        messageApi.info("Редактор ленты: сохраните, чтобы в JSON не осталось поля deck.");
      }
    });
  };

  if (user?.role !== "admin") {
    return (
      <div className="app-content">
        {holder}
        <Card>
          <Paragraph>Раздел только для администратора.</Paragraph>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-content admin-lesson-editor">
      {holder}
      <Spin spinning={loading || saving}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }} className="admin-lesson-editor__stack">
          <div className="admin-lesson-editor__header admin-lesson-editor__panel">
            <div className="admin-lesson-editor__header-main">
              <Title level={4} className="admin-lesson-editor__title">
                {title}
              </Title>
              {template ? (
                <Text type="secondary" className="admin-lesson-editor__meta">
                  {template.moduleKey} · #{template.sortOrder}
                </Text>
              ) : null}
            </div>
            <div className="admin-lesson-editor__header-actions">
              <Button type="link" className="admin-lesson-editor__back-btn" onClick={() => navigate("/admin/templates")}>
                Назад
              </Button>
              <Alert type="warning" showIcon message="Не забудь сохранить изменения перед выходом." />
            </div>
          </div>

          <div className="admin-lesson-editor__panel">
            <Space direction="vertical" size="small" style={{ width: "100%" }}>
              <Segmented
                value={editorMode}
                onChange={(v) => void requestModeChange(v as "flow" | "deck")}
                options={[
                  { label: "Лента", value: "flow" },
                  { label: "Слайды (канвас)", value: "deck" }
                ]}
              />
              <div className="admin-lesson-editor__quest-toggle">
                <Switch checked={questLayout} onChange={setQuestLayout} />
                <div>
                  <Text strong>Квест: карта миссий</Text>
                  <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4, maxWidth: 720 }}>
                    Ученик видит слева дорожку шагов, справа — активную миссию. Разбейте ленту блоков разделителями
                    («Разделитель» в редакторе): каждый отрезок между разделителями станет отдельной миссией с
                    заголовком из первого текстового блока.
                  </Paragraph>
                </div>
              </div>
              {questLayout && editorMode === "deck" ? (
                <Alert
                  type="info"
                  showIcon
                  message="В режиме квеста ученику показывается линейная лента, собранная из слайдов сверху вниз. Раскладка на канвасе влияет только на порядок блоков."
                />
              ) : null}
            </Space>
            {editorMode === "flow" ? (
              <AdminLessonBlockEditor blocks={blocks} onChange={setBlocks} />
            ) : (
              <AdminLessonDeckEditor deck={deck} onChange={setDeck} />
            )}
          </div>

          <Space className="admin-lesson-editor__footer-actions">
            <Button
              type="primary"
              onClick={async () => {
                if (!templateId) {
                  return;
                }
                setSaving(true);
                try {
                  const lessonContent =
                    editorMode === "deck"
                      ? lessonContentFromDeck(deck, { questLayout })
                      : lessonContentFromBlocks(blocks, { questLayout });
                  await apiClient.patch(`/api/admin/lesson-templates/${encodeURIComponent(templateId)}/content`, {
                    studentSummary: template?.studentSummary ?? null,
                    lessonContent
                  });
                  messageApi.success("Шаблон сохранен");
                } catch (e) {
                  messageApi.error(e instanceof Error ? e.message : "Не удалось сохранить шаблон");
                } finally {
                  setSaving(false);
                }
              }}
            >
              Сохранить
            </Button>
            <Button onClick={() => navigate("/admin/templates")}>К списку шаблонов</Button>
          </Space>
        </Space>
      </Spin>
    </div>
  );
}
