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
  const [joinCode, setJoinCode] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleteAck, setDeleteAck] = useState(false);
  const [nickname, setNickname] = useState("");

  useEffect(() => {
    setNickname(user?.nickname ?? "");
  }, [user]);

  if (!user) {
    return (
      <div className="app-content account-page">
        <Card>
          <Paragraph>Войдите в аккаунт, чтобы открыть личный кабинет</Paragraph>
          <Link to="/">
            <Button type="primary">На главную</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const handleJoinClassroom = async () => {
    try {
      await apiClient.post("/api/classrooms/join", { code: joinCode });
      await refreshMe();
      messageApi.success("Класс подключен");
    } catch (e) {
      messageApi.error(toUserErrorMessage(e));
    }
  };

  const handleNicknameSave = async () => {
    try {
      await apiClient.patch("/api/me/nickname", { nickname });
      await refreshMe();
      messageApi.success("Ник обновлен");
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
      {contextHolder}
      <Space direction="vertical" size="large" style={{ width: "100%", maxWidth: 560 }}>
        <Button
          type="link"
          onClick={() => window.dispatchEvent(new Event("nodly-open-settings"))}
          style={{ padding: 0, height: "auto" }}
        >
          Настройки (тема и оформление)
        </Button>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Спрайт персонажа настраивается в разделе{" "}
          <Link to="/studio">Разработка</Link> → вкладка «Персонаж».
        </Text>
        <Title level={4} style={{ margin: 0 }}>
          Личный кабинет
        </Title>
        {user.role === "teacher" ? (
          <Link to="/teacher">
            <Button type="primary">Кабинет учителя — классы и ученики</Button>
          </Link>
        ) : null}
        <Card title="Профиль">
          <Space direction="vertical" style={{ width: "100%" }}>
            <Text>
              Роль: {user.role === "teacher" ? "Учитель" : "Ученик"}
              {user.nickname ? ` · ${user.nickname}` : ""}
            </Text>
            <Text type="secondary">{user.email}</Text>
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
            <Button danger onClick={() => void logout()}>
              Выйти
            </Button>
          </Space>
        </Card>
        {user.role === "student" && user.studentMode === "school" ? (
          <Card title="Код класса">
            <Space wrap>
              <Input
                placeholder="Код класса"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                style={{ width: 200 }}
              />
              <Button type="primary" onClick={() => void handleJoinClassroom()}>
                Присоединиться
              </Button>
            </Space>
          </Card>
        ) : null}
        <Card title="Удаление аккаунта" styles={{ header: { borderBottomColor: "rgba(255, 77, 79, 0.35)" } }}>
          <Space direction="vertical" style={{ width: "100%", maxWidth: 480 }} size="middle">
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Необратимо: проекты, классы, зачисления и связанные данные в сервисе будут удалены
            </Paragraph>
            {user.hasPassword === false ? (
              <>
                <Text>
                  Для входа через Яндекс без пароля введи фразу целиком:{" "}
                  <Text code>
                    DELETE {user.email}
                  </Text>
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
  );
}
