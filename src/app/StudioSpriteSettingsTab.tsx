import { useEffect, useState } from "react";
import { Button, Card, Select, Space, Typography, message } from "antd";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient, toUserErrorMessage } from "@/shared/api/client";

const { Paragraph, Text } = Typography;

export function StudioSpriteSettingsTab() {
  const [messageApi, contextHolder] = message.useMessage();
  const { user, refreshMe } = useSessionStore();
  const [spriteCatalog, setSpriteCatalog] = useState<{ id: string; title: string }[]>([]);
  const [selectedSpriteId, setSelectedSpriteId] = useState<string>("");

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
  }, [user]);

  const handleSpriteSave = async () => {
    try {
      await apiClient.post("/api/me/sprite", { spritePackId: selectedSpriteId || undefined });
      await refreshMe();
      messageApi.success("Сохранено");
    } catch (e) {
      messageApi.error(toUserErrorMessage(e));
    }
  };

  if (!user) {
    return (
      <Card size="small" title="Персонаж">
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Войдите в аккаунт, чтобы выбрать набор спрайта.
        </Paragraph>
      </Card>
    );
  }

  return (
    <div className="studio-sprite-tab">
      {contextHolder}
      <Card size="small" title="Персонаж и спрайт">
        <Space direction="vertical" style={{ width: "100%", maxWidth: 400 }} size="middle">
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Набор спрайта используется на сцене в разработке.
          </Paragraph>
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
    </div>
  );
}
