import { useEffect, useState } from "react";
import { Button, Card, Layout, Typography, message } from "antd";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiClient, getApiBaseUrl } from "@/shared/api/client";
import { useSessionStore } from "@/store/useSessionStore";

const { Content } = Layout;
const { Paragraph, Title } = Typography;

export function ShareImportPage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useSessionStore();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    const base = getApiBaseUrl();
    void fetch(`${base}/api/share/${encodeURIComponent(token)}/meta`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then((j: { title?: string }) => setTitle(j.title ?? "Проект"))
      .catch(() => setTitle(null))
      .finally(() => setLoading(false));
  }, [token]);

  const handleClaim = async () => {
    if (!token || !user) {
      return;
    }
    setClaiming(true);
    try {
      const res = await apiClient.post<{ projectId: string }>(
        `/api/share/${encodeURIComponent(token)}/claim`,
        {}
      );
      messageApi.success("Черновик добавлен в твои проекты");
      navigate(`/studio?project=${encodeURIComponent(res.projectId)}`);
    } catch {
      messageApi.error("Не удалось импортировать по ссылке");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <Content className="app-content">
      {contextHolder}
      <Card style={{ maxWidth: 520 }}>
        <Title level={4} style={{ marginTop: 0 }}>
          Импорт проекта по ссылке
        </Title>
        {loading ? (
          <Paragraph type="secondary">Загрузка…</Paragraph>
        ) : !token ? (
          <Paragraph>Некорректная ссылка.</Paragraph>
        ) : title === null ? (
          <Paragraph>Ссылка недействительна или истекла.</Paragraph>
        ) : (
          <>
            <Paragraph>
              Тебе передали черновик проекта: <strong>{title}</strong>
            </Paragraph>
            <Paragraph type="secondary">
              После импорта откроется копия в разработке. Сохрани её в своих проектах.
            </Paragraph>
            {user ? (
              <Button type="primary" loading={claiming} onClick={() => void handleClaim()}>
                Импортировать в мои проекты
              </Button>
            ) : (
              <Paragraph style={{ marginBottom: 8 }}>
                <Link to="/">Войди</Link>, чтобы сохранить копию у себя.
              </Paragraph>
            )}
          </>
        )}
        <div style={{ marginTop: 16 }}>
          {user ? <Link to="/studio">В разработку</Link> : <Link to="/">На главную</Link>}
        </div>
      </Card>
    </Content>
  );
}
