import { useEffect, useMemo, useState } from "react";
import { Button, Card, List, Select, Space, Typography, message } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import { useOpenLessonTemplate, type LessonTemplateListItem } from "@/hooks/useOpenLessonTemplate";

const { Title, Paragraph } = Typography;

export function StudentLearningPage() {
  const { user } = useSessionStore();
  const navigate = useNavigate();
  const [messageApi, pageMessageHolder] = message.useMessage();
  const { openTemplate, openingId, contextHolder } = useOpenLessonTemplate();
  const [templates, setTemplates] = useState<LessonTemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusId, setFocusId] = useState<string>("");
  const [detailSummary, setDetailSummary] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const raw = await apiClient.get<unknown>("/api/lesson-templates");
        const list = Array.isArray(raw) ? (raw as LessonTemplateListItem[]) : [];
        setTemplates(list);
        setFocusId((prev) => {
          if (prev && list.some((t) => t.id === prev)) {
            return prev;
          }
          return list[0]?.id ?? "";
        });
      } catch {
        setTemplates([]);
        setFocusId("");
        messageApi.error("Не удалось загрузить каталог уроков");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messageApi стабилен для UX
  }, []);

  useEffect(() => {
    if (!focusId) {
      setDetailSummary(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const d = await apiClient.get<{ studentSummary: string | null }>(
          `/api/lesson-templates/${encodeURIComponent(focusId)}/content`
        );
        if (!cancelled) {
          setDetailSummary(d.studentSummary);
        }
      } catch {
        if (!cancelled) {
          setDetailSummary(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusId]);

  const active = useMemo(() => templates.find((t) => t.id === focusId) ?? null, [templates, focusId]);

  if (!user) {
    return (
      <Card>
        <Paragraph>Войдите, чтобы открыть раздел обучения</Paragraph>
        <Link to="/">На главную</Link>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {pageMessageHolder}
      {contextHolder}
      <div>
        <Title level={5} style={{ marginTop: 0 }}>
          Обучение
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Урок открывается в одном интерактивном режиме: презентация, шаги и проверки в одной ленте. Studio — для
          свободной разработки по кнопке внутри урока или ниже.
        </Paragraph>
      </div>
      <Card size="small" title="Каталог">
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Select
            style={{ width: "100%", maxWidth: 480 }}
            loading={loading}
            placeholder="Выбери урок"
            value={focusId || undefined}
            onChange={setFocusId}
            options={templates.map((t) => ({ value: t.id, label: `${t.title} (${t.moduleKey})` }))}
          />
          {active ? (
            <Card size="small" type="inner" title={active.title}>
              {detailSummary ? (
                <Paragraph style={{ marginBottom: 12 }}>{detailSummary}</Paragraph>
              ) : (
                <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                  {active.description ?? "Описание появится после загрузки с сервера."}
                </Paragraph>
              )}
              <Space wrap>
                <Button type="primary" size="large" onClick={() => navigate(`/lesson/${encodeURIComponent(active.id)}`)}>
                  Открыть урок
                </Button>
                <Button loading={openingId === active.id} onClick={() => void openTemplate(active)}>
                  Открыть в Studio (песочница)
                </Button>
              </Space>
            </Card>
          ) : null}
          <List
            bordered
            loading={loading}
            dataSource={templates}
            locale={{ emptyText: "Пока нет опубликованных уроков" }}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    key="player"
                    type="primary"
                    size="small"
                    onClick={() => navigate(`/lesson/${encodeURIComponent(item.id)}`)}
                  >
                    Открыть урок
                  </Button>,
                  <Button
                    key="go"
                    size="small"
                    loading={openingId === item.id}
                    onClick={() => void openTemplate(item)}
                  >
                    Studio
                  </Button>
                ]}
              >
                <List.Item.Meta title={item.title} description={item.description ?? `Модуль: ${item.moduleKey}`} />
              </List.Item>
            )}
          />
        </Space>
      </Card>
    </Space>
  );
}
