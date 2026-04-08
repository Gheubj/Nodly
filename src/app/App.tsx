import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import {
  Badge,
  Button,
  Drawer,
  Input,
  Layout,
  Modal,
  Select,
  Space,
  Tabs,
  Typography,
  message
} from "antd";
import { SettingOutlined, UserOutlined } from "@ant-design/icons";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AccountPage } from "@/app/AccountPage";
import { LandingPage } from "@/app/LandingPage";
import { StudioPage } from "@/app/StudioPage";
import { ClassPage } from "@/app/ClassPage";
import { LearningPage } from "@/app/LearningPage";
import { TeacherPage } from "@/app/TeacherPage";
import { ResetPasswordPage } from "@/app/ResetPasswordPage";
import { ShareImportPage } from "@/app/ShareImportPage";
import { SettingsPanel } from "@/app/SettingsPanel";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient, setAccessToken, toUserErrorMessage } from "@/shared/api/client";

const { Header } = Layout;
const { Title, Paragraph } = Typography;

function OpenSettingsDrawerAndHome() {
  const navigate = useNavigate();
  useEffect(() => {
    window.dispatchEvent(new Event("nodly-open-settings"));
    navigate("/", { replace: true });
  }, [navigate]);
  return null;
}

function RequireUser({ children }: { children: ReactElement }) {
  const { user, loading, sessionRestored } = useSessionStore();
  if (loading || !sessionRestored) {
    return (
      <div className="app-content">
        <Paragraph style={{ marginTop: 24 }}>Загрузка…</Paragraph>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export function App() {
  const location = useLocation();
  const [messageApi, contextHolder] = message.useMessage();
  const [authOpen, setAuthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"teacher" | "student">("student");
  const [studentMode, setStudentMode] = useState<"school" | "direct">("direct");
  const [nickname, setNickname] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [authLoginTab, setAuthLoginTab] = useState<"email" | "yandex">("email");
  const [yandexRole, setYandexRole] = useState<"teacher" | "student">("student");
  const [yandexStudentMode, setYandexStudentMode] = useState<"school" | "direct">("direct");
  const { user, register, login, requestRegistrationCode, requestForgotPassword } = useSessionStore();
  const [meSummary, setMeSummary] = useState<{
    pendingReviewCount?: number;
    assignmentAttentionCount?: number;
    newEnrollmentCount?: number;
  }>({});
  const prevPathRef = useRef<string | null>(null);

  const fetchSummary = useCallback(async () => {
    if (!user) {
      return;
    }
    const track =
      (user.role === "student" && user.studentMode === "school") || user.role === "teacher";
    if (!track) {
      return;
    }
    try {
      const data = await apiClient.get<{
        pendingReviewCount?: number;
        assignmentAttentionCount?: number;
        newEnrollmentCount?: number;
      }>("/api/me/summary");
      setMeSummary(data);
    } catch {
      setMeSummary({});
    }
  }, [user?.id, user?.role, user?.studentMode]);

  useEffect(() => {
    if (!user) {
      setMeSummary({});
      prevPathRef.current = null;
      return;
    }
    const track =
      (user.role === "student" && user.studentMode === "school") || user.role === "teacher";
    if (!track) {
      setMeSummary({});
      return;
    }
    void fetchSummary();
  }, [user, fetchSummary]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const track =
      (user.role === "student" && user.studentMode === "school") || user.role === "teacher";
    if (!track) {
      return;
    }
    if (prevPathRef.current === null) {
      prevPathRef.current = location.pathname;
      return;
    }
    const prev = prevPathRef.current;
    prevPathRef.current = location.pathname;
    const inZone = (p: string) => p === "/class" || p === "/teacher";
    if (inZone(prev) && !inZone(location.pathname)) {
      void fetchSummary();
    }
  }, [location.pathname, user, fetchSummary]);

  useEffect(() => {
    const onRefresh = () => void fetchSummary();
    window.addEventListener("nodly-refresh-header-summary", onRefresh);
    return () => window.removeEventListener("nodly-refresh-header-summary", onRefresh);
  }, [fetchSummary]);

  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("access_token")) {
      return;
    }
    const token = url.searchParams.get("access_token");
    if (token) {
      setAccessToken(token);
    }
    url.searchParams.delete("access_token");
    const qs = url.searchParams.toString();
    window.history.replaceState({}, "", `${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`);
  }, []);

  useEffect(() => {
    void useSessionStore.getState().restoreSession();
  }, []);

  useEffect(() => {
    const openAuth = () => setAuthOpen(true);
    window.addEventListener("nodly-open-auth", openAuth);
    return () => window.removeEventListener("nodly-open-auth", openAuth);
  }, []);

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener("nodly-open-settings", openSettings);
    return () => window.removeEventListener("nodly-open-settings", openSettings);
  }, []);

  const handleSendRegistrationCode = async () => {
    const normalized = email.trim();
    if (!normalized) {
      messageApi.error("Укажи email");
      return;
    }
    try {
      await requestRegistrationCode(normalized);
      messageApi.success("Код отправлен на почту");
    } catch (error) {
      messageApi.error(toUserErrorMessage(error));
    }
  };

  const handleAuth = async () => {
    try {
      if (isRegister) {
        await register({
          email,
          password,
          verificationCode: verificationCode.trim(),
          nickname,
          role,
          studentMode
        });
      } else {
        await login(email, password);
      }
      setAuthOpen(false);
      setVerificationCode("");
      setAuthLoginTab("email");
      messageApi.success(isRegister ? "Регистрация выполнена" : "Вход выполнен");
    } catch (error) {
      messageApi.error(toUserErrorMessage(error));
    }
  };

  const handleForgotSubmit = async () => {
    const normalized = forgotEmail.trim() || email.trim();
    if (!normalized) {
      messageApi.error("Укажи email");
      return;
    }
    try {
      await requestForgotPassword(normalized);
      messageApi.success("Если аккаунт есть, письмо отправлено");
      setForgotOpen(false);
    } catch (error) {
      messageApi.error(toUserErrorMessage(error));
    }
  };

  const headerNavClass = ({ isActive }: { isActive: boolean }) =>
    `app-header-nav-link${isActive ? " app-header-nav-link--active" : ""}`;

  const handleYandexContinue = () => {
    const api = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
    const params = new URLSearchParams({
      role: yandexRole,
      studentMode: yandexRole === "teacher" ? "direct" : yandexStudentMode
    });
    window.location.href = `${api}/api/auth/yandex/start?${params.toString()}`;
  };

  return (
    <Layout className="app-layout">
      {contextHolder}
      <Header className={`app-header app-header--edge${user ? " app-header--authed" : ""}`}>
        <Title level={3} className="app-title">
          <Link to="/" className="app-title-link app-brand" aria-label="Nodly — на главную">
            <span className="app-brand-logo-wrap" aria-hidden>
              <img src="/nodly-mark-header.png" alt="" className="app-brand-logo" width={80} height={88} />
            </span>
            <span className="app-brand-text">Nodly</span>
          </Link>
        </Title>
        <div className="app-header-trailing">
          <nav className="app-header-nav" aria-label="Основные разделы">
            {!user ? (
              <button
                type="button"
                className={`app-header-nav-link app-header-nav-link--button${settingsOpen ? " app-header-nav-link--active" : ""}`}
                aria-expanded={settingsOpen}
                aria-label="Настройки"
                onClick={() => setSettingsOpen(true)}
              >
                <SettingOutlined aria-hidden />
                Настройки
              </button>
            ) : null}
            {user ? (
              <NavLink to="/" end className={headerNavClass}>
                Главная
              </NavLink>
            ) : null}
            {user ? (
              <NavLink to="/studio" className={headerNavClass}>
                Разработка
              </NavLink>
            ) : null}
            {user?.role === "student" && user.studentMode === "school" ? (
              <Badge count={meSummary.assignmentAttentionCount ?? 0} size="small" offset={[8, 2]}>
                <NavLink
                  to="/class"
                  className={headerNavClass}
                  style={{ display: "inline-block" }}
                  onClick={() =>
                    setMeSummary((s) => ({
                      ...s,
                      assignmentAttentionCount: 0
                    }))
                  }
                >
                  Класс
                </NavLink>
              </Badge>
            ) : null}
            {user?.role === "student" && user.studentMode === "direct" ? (
              <NavLink to="/learning" className={headerNavClass}>
                Обучение
              </NavLink>
            ) : null}
            {user?.role === "teacher" ? (
              <Badge
                count={
                  (meSummary.pendingReviewCount ?? 0) + (meSummary.newEnrollmentCount ?? 0)
                }
                size="small"
                offset={[8, 2]}
              >
                <NavLink
                  to="/teacher"
                  className={headerNavClass}
                  style={{ display: "inline-block" }}
                  onClick={() =>
                    setMeSummary((s) => ({
                      ...s,
                      pendingReviewCount: 0,
                      newEnrollmentCount: 0
                    }))
                  }
                >
                  Кабинет учителя
                </NavLink>
              </Badge>
            ) : null}
          </nav>
          <div className="app-header-right">
            {!user ? (
              <Button type="primary" onClick={() => setAuthOpen(true)}>
                Войти
              </Button>
            ) : null}
          </div>
        </div>
        {user ? (
          <div className="app-header-account-cluster">
            <div className="app-header-account-slot">
              <Button
                type="text"
                size="large"
                icon={<SettingOutlined className="app-header-account-icon" />}
                className={`header-user-btn app-header-account-btn app-header-settings-btn${settingsOpen ? " app-header-settings-btn--active" : ""}`}
                aria-label="Настройки"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen(true)}
              />
              <span className="app-header-nickname">Настройки</span>
            </div>
            <Link to="/account" className="app-header-account-slot" aria-label="Личный кабинет">
              <Button
                type="text"
                size="large"
                icon={<UserOutlined className="app-header-account-icon" />}
                className="header-user-btn app-header-account-btn"
              />
              <span className="app-header-nickname" title={user.nickname}>
                {user.nickname}
              </span>
            </Link>
          </div>
        ) : null}
      </Header>
      <Drawer
        title="Настройки"
        placement="right"
        width={360}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        destroyOnClose={false}
        rootClassName="app-settings-drawer"
      >
        <SettingsPanel variant="drawer" onAfterNavigate={() => setSettingsOpen(false)} />
      </Drawer>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/settings" element={<OpenSettingsDrawerAndHome />} />
        <Route
          path="/studio"
          element={
            <RequireUser>
              <StudioPage />
            </RequireUser>
          }
        />
        <Route
          path="/class"
          element={
            <RequireUser>
              <ClassPage />
            </RequireUser>
          }
        />
        <Route
          path="/learning"
          element={
            <RequireUser>
              <LearningPage />
            </RequireUser>
          }
        />
        <Route
          path="/account"
          element={
            <RequireUser>
              <AccountPage />
            </RequireUser>
          }
        />
        <Route
          path="/teacher"
          element={
            <RequireUser>
              <TeacherPage />
            </RequireUser>
          }
        />
        <Route path="/share/:token" element={<ShareImportPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Routes>
      <Modal
        open={authOpen}
        title="Вход"
        onCancel={() => {
          setAuthOpen(false);
          setVerificationCode("");
          setAuthLoginTab("email");
        }}
        footer={
          authLoginTab === "email"
            ? [
                <Button
                  key="cancel"
                  onClick={() => {
                    setAuthOpen(false);
                    setVerificationCode("");
                    setAuthLoginTab("email");
                  }}
                >
                  Отмена
                </Button>,
                <Button key="submit" type="primary" onClick={() => void handleAuth()}>
                  {isRegister ? "Создать аккаунт" : "Войти"}
                </Button>
              ]
            : [
                <Button
                  key="cancel"
                  onClick={() => {
                    setAuthOpen(false);
                    setAuthLoginTab("email");
                  }}
                >
                  Отмена
                </Button>,
                <Button key="yandex" type="primary" onClick={() => handleYandexContinue()}>
                  Продолжить в Яндексе
                </Button>
              ]
        }
      >
        <Tabs
          activeKey={authLoginTab}
          onChange={(k) => setAuthLoginTab(k as "email" | "yandex")}
          items={[
            {
              key: "email",
              label: "Почта",
              children: (
                <Space direction="vertical" style={{ width: "100%", marginTop: 8 }}>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    {isRegister ? "Регистрация по email и коду из письма." : "Вход по email и паролю."}
                  </Paragraph>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
                  {isRegister ? (
                    <Space.Compact style={{ width: "100%" }}>
                      <Button onClick={() => void handleSendRegistrationCode()}>Отправить код</Button>
                    </Space.Compact>
                  ) : null}
                  <Input.Password
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Пароль"
                  />
                  {isRegister ? (
                    <>
                      <Input
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="Код из письма (6 цифр)"
                        maxLength={6}
                      />
                      <Input
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder="Ник (уникальный)"
                      />
                      <Select
                        value={role}
                        onChange={(v) => setRole(v)}
                        options={[
                          { value: "student", label: "Ученик" },
                          { value: "teacher", label: "Учитель" }
                        ]}
                      />
                      <Select
                        value={studentMode}
                        onChange={(v) => setStudentMode(v)}
                        options={[
                          { value: "direct", label: "Ученик без учителя" },
                          { value: "school", label: "Ученик школы" }
                        ]}
                        disabled={role !== "student"}
                      />
                    </>
                  ) : (
                    <Button
                      type="link"
                      style={{ padding: 0 }}
                      onClick={() => {
                        setForgotEmail(email);
                        setForgotOpen(true);
                      }}
                    >
                      Забыли пароль?
                    </Button>
                  )}
                  <Button
                    type="link"
                    onClick={() => {
                      setIsRegister((v) => !v);
                      setVerificationCode("");
                    }}
                  >
                    {isRegister ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
                  </Button>
                </Space>
              )
            },
            {
              key: "yandex",
              label: "Яндекс",
              children: (
                <Space direction="vertical" style={{ width: "100%", marginTop: 8 }}>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    Вход или первый вход через Яндекс ID. Для нового аккаунта выбери роль; у существующего
                    пользователя роль не меняется.
                  </Paragraph>
                  <Select
                    value={yandexRole}
                    onChange={(v) => setYandexRole(v)}
                    style={{ width: "100%" }}
                    options={[
                      { value: "student", label: "Ученик" },
                      { value: "teacher", label: "Учитель" }
                    ]}
                  />
                  <Select
                    value={yandexStudentMode}
                    onChange={(v) => setYandexStudentMode(v)}
                    style={{ width: "100%" }}
                    options={[
                      { value: "direct", label: "Ученик без учителя" },
                      { value: "school", label: "Ученик школы" }
                    ]}
                    disabled={yandexRole !== "student"}
                  />
                </Space>
              )
            }
          ]}
        />
      </Modal>
      <Modal
        open={forgotOpen}
        title="Сброс пароля"
        okText="Отправить ссылку"
        onCancel={() => setForgotOpen(false)}
        onOk={() => void handleForgotSubmit()}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value)}
            placeholder="Email аккаунта"
          />
        </Space>
      </Modal>
    </Layout>
  );
}
