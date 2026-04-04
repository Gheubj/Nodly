import { useEffect, useLayoutEffect, useState } from "react";
import {
  Button,
  Input,
  Layout,
  Modal,
  Select,
  Space,
  Tabs,
  Typography,
  message
} from "antd";
import { UserOutlined } from "@ant-design/icons";
import { Link, Route, Routes } from "react-router-dom";
import { AccountPage } from "@/app/AccountPage";
import { HomePage } from "@/app/HomePage";
import { TeacherPage } from "@/app/TeacherPage";
import { ResetPasswordPage } from "@/app/ResetPasswordPage";
import { useSessionStore } from "@/store/useSessionStore";
import { setAccessToken } from "@/shared/api/client";

const { Header } = Layout;
const { Title, Paragraph } = Typography;

export function App() {
  const [messageApi, contextHolder] = message.useMessage();
  const [authOpen, setAuthOpen] = useState(false);
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
      messageApi.error(error instanceof Error ? error.message : "Не удалось отправить код");
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
      messageApi.error(error instanceof Error ? error.message : "Ошибка авторизации");
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
      messageApi.error(error instanceof Error ? error.message : "Ошибка запроса");
    }
  };

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
      <Header className={`app-header${user ? " app-header--authed" : ""}`}>
        <Title level={3} className="app-title">
          <Link to="/" className="app-title-link">
            Noda PoC - AI в браузере
          </Link>
        </Title>
        <div className="app-header-right">
          {!user ? (
            <Button type="primary" onClick={() => setAuthOpen(true)}>
              Войти
            </Button>
          ) : null}
          {user?.role === "teacher" ? (
            <Link to="/teacher">
              <Button type="default" className="app-header-teacher-btn">
                Кабинет учителя
              </Button>
            </Link>
          ) : null}
        </div>
        {user ? (
          <Link to="/account" className="app-header-account" aria-label="Личный кабинет">
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
        ) : null}
      </Header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/teacher" element={<TeacherPage />} />
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
