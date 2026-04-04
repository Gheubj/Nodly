import { Card, List, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";

const { Title, Paragraph } = Typography;

const PLACEHOLDER_LESSONS = [
  { key: "1", title: "Урок 1. Введение в ИИ", note: "Скоро" },
  { key: "2", title: "Урок 2. Данные и разметка", note: "Скоро" },
  { key: "3", title: "Урок 3. Первая модель", note: "Скоро" }
];

export function StudentLearningPage() {
  const { user } = useSessionStore();

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
      <div>
        <Title level={5} style={{ marginTop: 0 }}>
          Обучение
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Здесь будут уроки и трек по программе (модули A–D). Пока — заглушки.
        </Paragraph>
      </div>
      <List
        bordered
        dataSource={PLACEHOLDER_LESSONS}
        renderItem={(item) => (
          <List.Item>
            <List.Item.Meta title={item.title} description={item.note} />
          </List.Item>
        )}
      />
    </Space>
  );
}
