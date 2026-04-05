import { Button, Card, Layout, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";

const { Content } = Layout;
const { Title, Paragraph } = Typography;

export function LandingPage() {
  const { user } = useSessionStore();

  const guestBlock = (
    <Card title="Добро пожаловать">
      <Paragraph>
        Noda — платформа, где можно собирать данные, обучать модели и собирать ИИ-проекты в браузере через
        визуальное программирование (Blockly).
      </Paragraph>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Войди через кнопку «Войти» в шапке — после входа откроется раздел «Разработка» с Blockly и сохранением
        проектов в облаке.
      </Paragraph>
    </Card>
  );

  const teacherBlock = (
    <Card title="Учителю">
      <Paragraph>
        В разделе <Link to="/studio">Разработка</Link> — та же среда проектов, что и у учеников. В{" "}
        <Link to="/teacher">кабинете учителя</Link> можно создавать школы и классы, выдавать код для входа
        учеников.
      </Paragraph>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Дальше по плану: задания, журнал, готовые уроки и материалы.
      </Paragraph>
    </Card>
  );

  const studentSchoolBlock = (
    <Card title="Ученику (школа)">
      <Paragraph>
        В <Link to="/class">Классе</Link> — школа, учитель и код класса. В{" "}
        <Link to="/studio">Разработке</Link> — твои проекты и Blockly.
      </Paragraph>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Если ещё не подключился к классу, введи код в личном кабинете.
      </Paragraph>
    </Card>
  );

  const studentDirectBlock = (
    <Card title="Ученику (самостоятельно)">
      <Paragraph>
        В <Link to="/learning">Обучении</Link> появятся уроки и трек по программе. В{" "}
        <Link to="/studio">Разработке</Link> — свободные эксперименты с проектами.
      </Paragraph>
    </Card>
  );

  let roleCard = guestBlock;
  if (user?.role === "teacher") {
    roleCard = teacherBlock;
  } else if (user?.role === "student" && user.studentMode === "school") {
    roleCard = studentSchoolBlock;
  } else if (user?.role === "student" && user.studentMode === "direct") {
    roleCard = studentDirectBlock;
  }

  return (
    <Content className="app-content landing-page">
      <Space direction="vertical" size="large" style={{ width: "100%", maxWidth: 720 }}>
        <div>
          <Title level={4} style={{ marginTop: 0 }}>
            Главная
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Краткий обзор и куда перейти дальше — навигация в шапке.
          </Paragraph>
        </div>
        {roleCard}
        <Card size="small" title="Быстрые ссылки">
          <Space wrap>
            {user ? (
              <Link to="/studio">
                <Button type="primary">Разработка</Button>
              </Link>
            ) : null}
            {user?.role === "student" && user.studentMode === "school" ? (
              <Link to="/class">
                <Button>Класс</Button>
              </Link>
            ) : null}
            {user?.role === "student" && user.studentMode === "direct" ? (
              <Link to="/learning">
                <Button>Обучение</Button>
              </Link>
            ) : null}
            {user?.role === "teacher" ? (
              <Link to="/teacher">
                <Button>Кабинет учителя</Button>
              </Link>
            ) : null}
            {user ? (
              <Link to="/account">
                <Button>Личный кабинет</Button>
              </Link>
            ) : null}
          </Space>
        </Card>
      </Space>
    </Content>
  );
}
