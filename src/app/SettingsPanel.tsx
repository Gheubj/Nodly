import { Button, Card, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import { ThemeModeControl } from "@/app/ThemeModeControl";
import { useSessionStore } from "@/store/useSessionStore";

const { Paragraph, Text } = Typography;

type Props = {
  /** В выезжающей панели — без лишних отступов страницы */
  variant?: "drawer" | "page";
  /** После перехода по ссылке (например закрыть Drawer) */
  onAfterNavigate?: () => void;
};

export function SettingsPanel({ variant = "drawer", onAfterNavigate }: Props) {
  const { user } = useSessionStore();
  const gap = variant === "drawer" ? "middle" : "large";

  return (
    <Space direction="vertical" size={gap} style={{ width: "100%" }}>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Внешний вид приложения. Данные аккаунта — в личном кабинете
      </Paragraph>
      <Card title="Оформление" size="small">
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Тема интерфейса сохраняется в этом браузере
        </Text>
        <ThemeModeControl />
      </Card>
      {user ? (
        <Link to="/account" onClick={() => onAfterNavigate?.()}>
          <Button type="default" block>
            Личный кабинет
          </Button>
        </Link>
      ) : (
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Чтобы управлять профилем и классом, войди в аккаунт через кнопку «Войти» в шапке
        </Paragraph>
      )}
    </Space>
  );
}
