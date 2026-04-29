import { useEffect, useState } from "react";
import { Button, Card, Checkbox, Input, Space, Typography, message } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient, setAccessToken, toUserErrorMessage } from "@/shared/api/client";

const { Title, Paragraph, Text } = Typography;

export function AccountPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const navigate = useNavigate();
  const { user, refreshMe, logout, setUser } = useSessionStore();
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleteAck, setDeleteAck] = useState(false);
  const [nickname, setNickname] = useState("");
  const [addEmail, setAddEmail] = useState("");

  useEffect(() => {
    setNickname(user?.nickname ?? "");
  }, [user]);

  if (!user) {
    return (
      <div className="app-content account-page">
        <div className="account-page__inner">
          <div className="account-page__column">
            <Card>
              <Paragraph>Войдите в аккаунт, чтобы открыть личный кабинет</Paragraph>
              <Link to="/">
                <Button type="primary">На главную</Button>
              </Link>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  const handleNicknameSave = async () => {
    try {
      await apiClient.patch("/api/me/nickname", { nickname });
      await refreshMe();
      messageApi.success("Ник обновлен");
    } catch (e) {
      messageApi.error(toUserErrorMessage(e));
    }
  };

  const handleAddEmailSave = async () => {
    const trimmed = addEmail.trim();
    if (!trimmed) {
      messageApi.warning("Введите email");
      return;
    }
    try {
      await apiClient.patch("/api/me/email", { email: trimmed });
      setAddEmail("");
      await refreshMe();
      messageApi.success("Почта сохранена");
    } catch (e) {
      messageApi.error(toUserErrorMessage(e));
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteAck) {
      messageApi.warning("Отметь, что понимаешь последствия удаления.");
      return;
    }
    try {
      const body =
        user?.hasPassword === false
          ? { confirmPhrase: deletePhrase.trim() }
          : { password: deletePassword };
      await apiClient.post<{ ok: boolean }>("/api/me/delete-account", body);
      setAccessToken("");
      setUser(null);
      messageApi.success("Аккаунт удалён");
      navigate("/");
    } catch (e) {
      messageApi.error(toUserErrorMessage(e));
    }
  };

  return (
    <div className="app-content account-page">
      <div className="account-page__inner">
        {contextHolder}
        <div className="account-page__column">
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Title level={4} style={{ margin: 0 }}>
              Личный кабинет
            </Title>
            {user.role === "teacher" ? (
              <Link to="/teacher">
                <Button type="primary">Кабинет учителя — классы и ученики</Button>
              </Link>
            ) : null}
            <Card title="Профиль" data-onboarding="account-profile">
              <Space direction="vertical" style={{ width: "100%" }}>
                <Text>
                  Роль: {user.role === "teacher" ? "Учитель" : "Ученик"}
                  {user.nickname ? ` · ${user.nickname}` : ""}
                </Text>
                <Text type="secondary">
                  {user.email ? <>Почта: {user.email}</> : <>Почта не указана — уведомления на email не отправляются</>}
                </Text>
                {!user.email ? (
                  <Space.Compact style={{ width: "100%", maxWidth: 400 }}>
                    <Input
                      type="email"
                      value={addEmail}
                      onChange={(e) => setAddEmail(e.target.value)}
                      placeholder="Добавить email для уведомлений"
                    />
                    <Button type="primary" onClick={() => void handleAddEmailSave()}>
                      Сохранить
                    </Button>
                  </Space.Compact>
                ) : null}
                <Space.Compact style={{ width: "100%", maxWidth: 360 }}>
                  <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Ник" />
                  <Button type="primary" onClick={() => void handleNicknameSave()}>
                    Сменить ник
                  </Button>
                </Space.Compact>
                {user.role === "student" ? (
                  <Text>
                    Режим: {user.studentMode === "school" ? "со школой (по коду класса)" : "самостоятельное обучение"}
                  </Text>
                ) : null}
                {user.role === "student" && user.studentMode === "school" ? (
                  <Text>
                    Класс:{" "}
                    {user.enrollments && user.enrollments.length > 0
                      ? user.enrollments.map((e) => e.classroomTitle).join(", ")
                      : "не подключен"}
                  </Text>
                ) : null}
                <Button danger onClick={() => void logout()}>
                  Выйти
                </Button>
              </Space>
            </Card>
            <Card title="Удаление аккаунта" styles={{ header: { borderBottomColor: "rgba(255, 77, 79, 0.35)" } }}>
              <Space direction="vertical" style={{ width: "100%", maxWidth: 480 }} size="middle">
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  Необратимо: проекты, классы, зачисления и связанные данные в сервисе будут удалены
                </Paragraph>
                {user.hasPassword === false ? (
                  <>
                    <Text>
                      Для аккаунта без пароля введи фразу целиком:{" "}
                      <Text code>DELETE {user.email ?? user.nickname}</Text>
                    </Text>
                    <Input
                      placeholder="Фраза подтверждения"
                      value={deletePhrase}
                      onChange={(e) => setDeletePhrase(e.target.value)}
                    />
                  </>
                ) : (
                  <Input.Password
                    placeholder="Текущий пароль"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                  />
                )}
                <Checkbox checked={deleteAck} onChange={(e) => setDeleteAck(e.target.checked)}>
                  Понимаю, что восстановление будет невозможно
                </Checkbox>
                <Button type="primary" danger onClick={() => void handleDeleteAccount()}>
                  Удалить аккаунт навсегда
                </Button>
              </Space>
            </Card>
          </Space>
        </div>
      </div>
    </div>
  );
}
