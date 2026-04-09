import { Button, Card, Layout, Typography } from "antd";
import { Link } from "react-router-dom";
import { StudentLearningPage } from "@/app/StudentLearningPage";
import { useSessionStore } from "@/store/useSessionStore";

const { Content } = Layout;
const { Paragraph } = Typography;

export function LearningPage() {
  const { user } = useSessionStore();

  if (!user) {
    return (
      <Content className="app-content">
        <Card>
          <Paragraph>Раздел «Обучение» доступен после входа</Paragraph>
          <Link to="/">
            <Button type="primary">На главную</Button>
          </Link>
        </Card>
      </Content>
    );
  }

  if (user.role !== "student" || user.studentMode !== "direct") {
    return (
      <Content className="app-content">
        <Card>
          <Paragraph>Эта страница для учеников в режиме самостоятельного обучения</Paragraph>
          <Link to="/">
            <Button type="primary">На главную</Button>
          </Link>
        </Card>
      </Content>
    );
  }

  return (
    <Content className="app-content">
      <StudentLearningPage />
    </Content>
  );
}
