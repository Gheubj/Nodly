import { useEffect, useState } from "react";
import { Button, Card, List, Space, Typography, message } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import type { NodlyProjectSnapshot } from "@/shared/types/project";

const { Title, Paragraph } = Typography;

interface LessonTemplateListItem {
  id: string;
  title: string;
  description: string | null;
  moduleKey: string;
  sortOrder: number;
}

function randomProjectId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `p_${hex}`;
}

export function StudentLearningPage() {
  const { user } = useSessionStore();
  const [messageApi, contextHolder] = message.useMessage();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<LessonTemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const list = await apiClient.get<LessonTemplateListItem[]>("/api/lesson-templates");
        setTemplates(list);
      } catch {
        setTemplates([]);
        messageApi.error("Не удалось загрузить каталог уроков");
      } finally {
        setLoading(false);
      }
    })();
    // каталог уроков — один раз при монтировании
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messageApi стабилен для UX
  }, []);

  const openTemplate = async (t: LessonTemplateListItem) => {
    if (!user) {
      return;
    }
    setOpeningId(t.id);
    try {
      const { starterPayload } = await apiClient.get<{ starterPayload: NodlyProjectSnapshot }>(
        `/api/lesson-templates/${t.id}/starter`
      );
      const projectId = randomProjectId();
      await apiClient.put(`/api/projects/${projectId}`, {
        title: t.title,
        snapshot: starterPayload as unknown as Record<string, unknown>
      });
      navigate(`/studio?project=${encodeURIComponent(projectId)}`);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось открыть урок");
    } finally {
      setOpeningId(null);
    }
  };

  if (!user) {
    return (
      <Card>
        <Paragraph>Войдите, чтобы открыть раздел обучения.</Paragraph>
        <Link to="/">На главную</Link>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {contextHolder}
      <div>
        <Title level={5} style={{ marginTop: 0 }}>
          Обучение
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Уроки из каталога. Открывается новый проект в разработке — сохрани его в библиотеке, когда будешь готов.
        </Paragraph>
      </div>
      <List
        bordered
        loading={loading}
        dataSource={templates}
        locale={{ emptyText: "Пока нет опубликованных уроков" }}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button
                key="go"
                type="primary"
                size="small"
                loading={openingId === item.id}
                onClick={() => void openTemplate(item)}
              >
                Открыть в разработке
              </Button>
            ]}
          >
            <List.Item.Meta
              title={item.title}
              description={item.description ?? `Модуль: ${item.moduleKey}`}
            />
          </List.Item>
        )}
      />
    </Space>
  );
}
