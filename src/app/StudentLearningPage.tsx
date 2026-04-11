import { useEffect, useState } from "react";
import { Button, Card, List, Space, Typography, message } from "antd";
import { Link } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import { useOpenLessonTemplate, type LessonTemplateListItem } from "@/hooks/useOpenLessonTemplate";

const { Title, Paragraph } = Typography;

export function StudentLearningPage() {
  const { user } = useSessionStore();
  const [messageApi, pageMessageHolder] = message.useMessage();
  const { openTemplate, openingId, contextHolder } = useOpenLessonTemplate();
  const [templates, setTemplates] = useState<LessonTemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messageApi стабилен для UX
  }, []);

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
          Уроки из каталога. Открывается новый проект в разработке — сохрани его в библиотеке, когда будешь готов
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
