import { Card, Empty, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";

const { Title, Paragraph, Text } = Typography;

export function StudentClassPage() {
  const { user } = useSessionStore();
  const enrollments = user?.enrollments ?? [];

  if (!user) {
    return (
      <Empty description="Войдите, чтобы увидеть класс" image={Empty.PRESENTED_IMAGE_SIMPLE}>
        <Link to="/">На главную</Link>
      </Empty>
    );
  }

  if (enrollments.length === 0) {
    return (
      <Card>
        <Title level={5} style={{ marginTop: 0 }}>
          Ты ещё не в классе
        </Title>
        <Paragraph type="secondary">
          Попроси код у учителя и введи его в{" "}
          <Link to="/account">личном кабинете</Link> (раздел «Класс»).
        </Paragraph>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {enrollments.map((e) => (
        <Card key={e.id} title={e.classroomTitle}>
          <Space direction="vertical" size="small">
            <div>
              <Text type="secondary">Школа / организация: </Text>
              <Text strong>{e.schoolName}</Text>
            </div>
            <div>
              <Text type="secondary">Учитель: </Text>
              <Text strong>{e.teacherNickname}</Text>
              <Text type="secondary"> ({e.teacherEmail})</Text>
            </div>
            <div>
              <Text type="secondary">Код класса (для одноклассников): </Text>
              <Text code>{e.classCode}</Text>
            </div>
          </Space>
        </Card>
      ))}
    </Space>
  );
}
