import { Button, Card, Col, Row, Typography } from "antd";
import { TeamOutlined, UserOutlined, ExperimentOutlined } from "@ant-design/icons";

const { Paragraph, Title } = Typography;

function openAuthModal() {
  window.dispatchEvent(new Event("nodly-open-auth"));
}

export function LandingGuestPaths() {
  return (
    <div className="landing-guest-paths">
      <Title level={5} className="landing-guest-paths__title">
        Как вы планируете пользоваться Nodly?
      </Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card size="small" title="Я учитель или веду кружок" className="landing-guest-paths__card">
            <Paragraph type="secondary" style={{ marginBottom: 12, minHeight: 56 }}>
              Создайте школу, классы и задавайте работы ученикам. Та же среда разработки, что и у детей.
            </Paragraph>
            <Button type="primary" block icon={<TeamOutlined />} onClick={openAuthModal}>
              Войти или зарегистрироваться
            </Button>
            <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              При регистрации выберите роль «Учитель»
            </Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="Я ученик в классе" className="landing-guest-paths__card">
            <Paragraph type="secondary" style={{ marginBottom: 12, minHeight: 56 }}>
              Получите код от учителя, введите его в личном кабинете и открывайте задания и расписание.
            </Paragraph>
            <Button type="primary" block icon={<UserOutlined />} onClick={openAuthModal}>
              Войти или зарегистрироваться
            </Button>
            <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              Роль «Ученик», режим «Ученик школы»
            </Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="Учусь сам" className="landing-guest-paths__card">
            <Paragraph type="secondary" style={{ marginBottom: 12, minHeight: 56 }}>
              Уроки из каталога и свободные проекты в Blockly без привязки к школе.
            </Paragraph>
            <Button type="primary" block icon={<ExperimentOutlined />} onClick={openAuthModal}>
              Войти или зарегистрироваться
            </Button>
            <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              Роль «Ученик», режим «Ученик без учителя»
            </Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
