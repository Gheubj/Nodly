import { useCallback, useMemo, useState } from "react";
import { Button, Card, Layout, Space, Typography, message } from "antd";
import {
  CloudOutlined,
  CodeOutlined,
  DatabaseOutlined,
  RocketOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined
} from "@ant-design/icons";
import dayjs from "dayjs";
import { Link, useNavigate } from "react-router-dom";
import { useHtmlDataTheme } from "@/hooks/useHtmlDataTheme";
import { useHomeSchoolAssignments } from "@/hooks/useHomeSchoolAssignments";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import { HomeSchedulePreview } from "@/app/HomeSchedulePreview";
import { HomeUpcomingHomework } from "@/app/HomeUpcomingHomework";

const { Content } = Layout;
const { Title, Paragraph, Text } = Typography;

function openAuthModal() {
  window.dispatchEvent(new Event("nodly-open-auth"));
}

export function LandingPage() {
  const { user } = useSessionStore();
  const navigate = useNavigate();
  const htmlTheme = useHtmlDataTheme();
  const [messageApi, messageHolder] = message.useMessage();
  const schoolStudent = Boolean(user?.role === "student" && user.studentMode === "school");
  const { rows: homeHwRows, loading: homeHwLoading, reload: reloadHomeHw } =
    useHomeSchoolAssignments(schoolStudent);
  const [heroHwBusy, setHeroHwBusy] = useState(false);

  const heroHwAction = useMemo(() => {
    if (!schoolStudent) {
      return null;
    }
    const hwList = homeHwRows.filter((r) => r.kind === "homework");
    const withDue = hwList
      .filter((r) => r.dueAt)
      .sort((a, b) => dayjs(a.dueAt).valueOf() - dayjs(b.dueAt).valueOf());
    const pool = withDue.length > 0 ? withDue : [...hwList].sort((a, b) => a.title.localeCompare(b.title, "ru"));
    if (pool.length === 0) {
      return null;
    }
    const start = pool.find((r) => (r.submission?.status ?? "not_started") === "not_started" || !r.submission);
    if (start) {
      return { mode: "start" as const, row: start };
    }
    const cont = pool.find((r) => {
      const st = r.submission?.status ?? "not_started";
      return (st === "draft" || st === "needs_revision") && r.submission?.projectId;
    });
    if (cont) {
      return { mode: "continue" as const, row: cont };
    }
    return null;
  }, [schoolStudent, homeHwRows]);

  const handleHeroHomework = useCallback(async () => {
    if (!heroHwAction) {
      return;
    }
    setHeroHwBusy(true);
    try {
      if (heroHwAction.mode === "start") {
        const res = await apiClient.post<{ projectId: string }>(
          `/api/student/assignments/${heroHwAction.row.assignmentId}/start`,
          {}
        );
        navigate(`/studio?project=${encodeURIComponent(res.projectId)}`);
      } else {
        const pid = heroHwAction.row.submission?.projectId;
        if (pid) {
          navigate(`/studio?project=${encodeURIComponent(pid)}`);
        }
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось открыть задание");
    } finally {
      setHeroHwBusy(false);
    }
  }, [heroHwAction, navigate, messageApi]);

  const guestBlock = (
    <Card className="landing-role-card" title="С чего начать">
      <Paragraph style={{ marginBottom: 12 }}>
        Войди через кнопку «Войти» в шапке
      </Paragraph>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Регистрация по email с кодом из письма или через Яндекс 
      </Paragraph>
    </Card>
  );

  const teacherBlock = (
    <Card className="landing-role-card" title="Учителю">
      <Paragraph>
        В разделе <Link to="/studio">Разработка</Link> — та же среда проектов, что и у учеников В{" "}
        <Link to="/teacher">кабинете учителя</Link> можно создавать школы и классы, выдавать код для входа
        учеников
      </Paragraph>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Задания, журнал и готовые уроки — в развитии платформы
      </Paragraph>
    </Card>
  );

  const studentSchoolBlock = (
    <Card className="landing-role-card" title="Ученику (школа)">
      <Paragraph>
        В <Link to="/class">Обучении</Link> — школа, учитель и задания В <Link to="/studio">Разработке</Link> — твои
        проекты
      </Paragraph>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Если ещё не подключился к классу, введи код в личном кабинете
      </Paragraph>
    </Card>
  );

  const studentDirectBlock = (
    <Card className="landing-role-card" title="Ученику (самостоятельно)">
      <Paragraph>
        В <Link to="/learning">Обучении</Link> — уроки и трек по программе В{" "}
        <Link to="/studio">Разработке</Link> — свободные эксперименты с проектами
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
      {messageHolder}
      <div className="landing-page__inner">
        <section className="landing-hero" aria-labelledby="landing-hero-title">
          <div className="landing-hero__headline">
            <img
              src={htmlTheme === "light" ? "/nodly-wordmark-outline.png" : "/nodly-wordmark-white.png"}
              alt="Nodly"
              className="landing-hero__wordmark"
              width={280}
              height={56}
              decoding="async"
            />
            <div className="landing-hero__headline-text">
              <Title level={1} id="landing-hero-title" className="landing-hero__title landing-hero__title--headline">
                ИИ и машинное обучение прямо в браузере
              </Title>
            </div>
          </div>
          <p className="landing-hero__lead">
            Собирай данные, обучай модели и собирай проекты через визуальное программирование — без установки
            среды на компьютер. Один аккаунт для учеников и учителей
          </p>
          <div className="landing-hero__actions">
            {user ? (
              <Link to="/studio">
                <Button type="primary" size="large" icon={<RocketOutlined />}>
                  Открыть разработку
                </Button>
              </Link>
            ) : (
              <Button type="primary" size="large" icon={<RocketOutlined />} onClick={openAuthModal}>
                Войти в аккаунт
              </Button>
            )}
            {schoolStudent && heroHwAction ? (
              <Button
                type="default"
                size="large"
                loading={homeHwLoading || heroHwBusy}
                onClick={() => void handleHeroHomework()}
              >
                {heroHwAction.mode === "start" ? "Начать" : "Продолжить"}
              </Button>
            ) : null}
            {user ? (
              <Link to="/account">
                <Button size="large">Личный кабинет</Button>
              </Link>
            ) : (
              <Text type="secondary" style={{ maxWidth: 280 }}>
                Уже есть аккаунт? Используй «Войти» в шапке или кнопку выше
              </Text>
            )}
          </div>
        </section>

        {user && (user.role === "teacher" || (user.role === "student" && user.studentMode === "school")) ? (
          <HomeSchedulePreview />
        ) : null}
        {schoolStudent ? (
          <HomeUpcomingHomework rows={homeHwRows} loading={homeHwLoading} onRefresh={reloadHomeHw} />
        ) : null}

        {user ? (
          <Card className="landing-quick-actions-card" title="С чего начать сегодня">
            <Space wrap size="middle">
              <Link to="/studio">
                <Button type="primary" icon={<RocketOutlined />}>
                  Разработка
                </Button>
              </Link>
              {user.role === "teacher" ? (
                <Link to="/teacher">
                  <Button icon={<TeamOutlined />}>Кабинет учителя</Button>
                </Link>
              ) : null}
              {user.role === "student" && user.studentMode === "school" ? (
                <Link to="/class">
                  <Button>Обучение</Button>
                </Link>
              ) : null}
              {user.role === "student" && user.studentMode === "direct" ? (
                <Link to="/learning">
                  <Button>Обучение</Button>
                </Link>
              ) : null}
              <Link to="/account">
                <Button icon={<UserOutlined />}>Личный кабинет</Button>
              </Link>
              <Button
                icon={<SettingOutlined />}
                onClick={() => window.dispatchEvent(new Event("nodly-open-settings"))}
              >
                Настройки
              </Button>
            </Space>
          </Card>
        ) : null}

        <div className="landing-features" id="features" role="list">
          <Card className="landing-feature-card" bordered={false} role="listitem">
            <div className="landing-feature-card__icon">
              <CodeOutlined />
            </div>
            <div className="landing-feature-card__title">Визуальное программирование</div>
            <p className="landing-feature-card__text">
              Blockly-среда: логика, циклы и вызовы моделей без классического кода на старте
            </p>
          </Card>
          <Card className="landing-feature-card" bordered={false} role="listitem">
            <div className="landing-feature-card__icon">
              <DatabaseOutlined />
            </div>
            <div className="landing-feature-card__title">Данные и модели</div>
            <p className="landing-feature-card__text">
              Наборы изображений и таблиц, обучение и предсказания — в рамках одного проекта
            </p>
          </Card>
          <Card className="landing-feature-card" bordered={false} role="listitem">
            <div className="landing-feature-card__icon">
              <CloudOutlined />
            </div>
            <div className="landing-feature-card__title">Облако и класс</div>
            <p className="landing-feature-card__text">
              Сохранение черновиков в облаке; для школ — классы, коды и задания от учителя
            </p>
          </Card>
        </div>

        {roleCard}
      </div>
    </Content>
  );
}
