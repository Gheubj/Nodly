import { Button, Card, Layout, Typography } from "antd";
import { Link } from "react-router-dom";
import { StudentClassPage } from "@/app/StudentClassPage";
import { useSessionStore } from "@/store/useSessionStore";

const { Content } = Layout;
const { Paragraph } = Typography;

export function ClassPage() {
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

  if (user.role !== "student" || user.studentMode !== "school") {
    return (
      <Content className="app-content">
        <Card>
          <Paragraph>Эта страница для учеников, которые учатся по школе (с кодом класса)</Paragraph>
          <Link to="/">
            <Button type="primary">На главную</Button>
          </Link>
        </Card>
      </Content>
    );
  }

  return (
    <Content className="app-content lms-shell-wide">
      <StudentClassPage />
    </Content>
  );
}
