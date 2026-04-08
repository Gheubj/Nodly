import { useEffect, useState } from "react";
import { Button, Card, Input, Select, Space, Typography, message } from "antd";
import { Link } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient, toUserErrorMessage } from "@/shared/api/client";

const { Title, Paragraph, Text } = Typography;

export function AccountPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const { user, refreshMe, logout } = useSessionStore();
  const [joinCode, setJoinCode] = useState("");
  const [spriteCatalog, setSpriteCatalog] = useState<{ id: string; title: string }[]>([]);
  const [selectedSpriteId, setSelectedSpriteId] = useState<string>("");
  const [nickname, setNickname] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }
    void (async () => {
      try {
        const result = await apiClient.get<{ packs: { id: string; title: string }[] }>("/api/sprites");
        setSpriteCatalog(result.packs);
      } catch {
        setSpriteCatalog([]);
      }
    })();
  }, [user]);

  useEffect(() => {
    const packId = user?.spriteSelection?.spritePack?.id;
    setSelectedSpriteId(packId ?? "");
    setNickname(user?.nickname ?? "");
  }, [user]);

  if (!user) {
    return (
      <div className="app-content account-page">
        <Card>
          <Paragraph>Войдите в аккаунт, чтобы открыть личный кабинет.</Paragraph>
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

  const handleSpriteSave = async () => {
    try {
      await apiClient.post("/api/me/sprite", { spritePackId: selectedSpriteId || undefined });
      await refreshMe();
      messageApi.success("Сохранено");
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

  return (
    <div className="app-content account-page">
      {contextHolder}
      <Space direction="vertical" size="large" style={{ width: "100%", maxWidth: 560 }}>
        <Link to="/studio">
          <Button type="link">← Назад в разработку</Button>
        </Link>
        <Button
          type="link"
          onClick={() => window.dispatchEvent(new Event("nodly-open-settings"))}
          style={{ padding: 0, height: "auto" }}
        >
          Настройки (тема и оформление)
        </Button>
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
          <Card title="Класс">
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
        <Card title="Персонаж и спрайт">
          <Space direction="vertical" style={{ width: "100%" }}>
            <Select
              style={{ width: "100%", maxWidth: 360 }}
              placeholder="Набор спрайта"
              value={selectedSpriteId || undefined}
              onChange={(v) => setSelectedSpriteId(v)}
              options={spriteCatalog.map((item) => ({ value: item.id, label: item.title }))}
              allowClear
            />
            <Button type="primary" onClick={() => void handleSpriteSave()}>
              Сохранить
            </Button>
            {user.spriteSelection?.spritePack?.title ? (
              <Text type="secondary">Сейчас: {user.spriteSelection.spritePack.title}</Text>
            ) : null}
          </Space>
        </Card>
      </Space>
    </div>
  );
}
