import { useEffect, useMemo, useState } from "react";
import { Button, Card, List, Select, Space, Typography, message } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import type { LessonTemplateListItem } from "@/hooks/useOpenLessonTemplate";

const { Title, Paragraph } = Typography;

export function StudentLearningPage() {
  const { user } = useSessionStore();
  const navigate = useNavigate();
  const [messageApi, pageMessageHolder] = message.useMessage();
  const [templates, setTemplates] = useState<LessonTemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusId, setFocusId] = useState<string>("");
  const [detailSummary, setDetailSummary] = useState<string | null>(null);
  const [directProgress, setDirectProgress] = useState<{
    threshold: number;
    modules: { moduleKey: string; avgScore: number; passed: boolean; unlocked: boolean }[];
  } | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const raw = await apiClient.get<unknown>("/api/lesson-templates");
        const list = Array.isArray(raw) ? (raw as LessonTemplateListItem[]) : [];
        setTemplates(list);
        setFocusId((prev) => {
          if (prev && list.some((t) => t.id === prev)) {
            return prev;
          }
          return list[0]?.id ?? "";
        });
      } catch {
        setTemplates([]);
        setFocusId("");
        messageApi.error("Не удалось загрузить каталог уроков");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messageApi стабилен для UX
  }, []);

  useEffect(() => {
    if (!focusId) {
      setDetailSummary(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const d = await apiClient.get<{ studentSummary: string | null }>(
          `/api/lesson-templates/${encodeURIComponent(focusId)}/content`
        );
        if (!cancelled) {
          setDetailSummary(d.studentSummary);
        }
      } catch {
        if (!cancelled) {
          setDetailSummary(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusId]);

  useEffect(() => {
    if (!(user?.role === "student" && user.studentMode === "direct")) {
      setDirectProgress(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const p = await apiClient.get<{
          threshold: number;
          modules: { moduleKey: string; avgScore: number; passed: boolean; unlocked: boolean }[];
        }>("/api/student/direct/block-progress");
        if (!cancelled) {
          setDirectProgress(p);
        }
      } catch {
        if (!cancelled) {
          setDirectProgress(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.role, user?.studentMode]);

  const active = useMemo(() => templates.find((t) => t.id === focusId) ?? null, [templates, focusId]);
  const directModuleStatus = useMemo(() => {
    const m = new Map<string, { avgScore: number; passed: boolean; unlocked: boolean }>();
    for (const row of directProgress?.modules ?? []) {
      m.set(row.moduleKey, { avgScore: row.avgScore, passed: row.passed, unlocked: row.unlocked });
    }
    return m;
  }, [directProgress]);

  if (!user) {
    return (
      <Card>
        <Paragraph>Войдите, чтобы открыть раздел обучения</Paragraph>
        <Link to="/">На главную</Link>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {pageMessageHolder}
      <div>
        <Title level={5} style={{ marginTop: 0 }}>
          Обучение
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Урок открывается только в интерактивном формате: презентация, мини-разработка и проверки в одной ленте.
        </Paragraph>
      </div>
      <Card size="small" title="Каталог">
        <div data-onboarding="direct-learning-catalog">
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Select
            style={{ width: "100%", maxWidth: 480 }}
            loading={loading}
            placeholder="Выбери урок"
            value={focusId || undefined}
            onChange={setFocusId}
            options={templates.map((t) => ({ value: t.id, label: `${t.title} (${t.moduleKey})` }))}
          />
          {active ? (
            <Card size="small" type="inner" title={active.title}>
              {detailSummary ? (
                <Paragraph style={{ marginBottom: 12 }}>{detailSummary}</Paragraph>
              ) : (
                <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                  {active.description ?? "Описание появится после загрузки с сервера."}
                </Paragraph>
              )}
              <Space wrap>
                <Button
                  type="primary"
                  size="large"
                  disabled={
                    user.studentMode === "direct" &&
                    (directModuleStatus.get(active.moduleKey)?.unlocked ?? true) === false
                  }
                  onClick={() => navigate(`/lesson/${encodeURIComponent(active.id)}`)}
                >
                  Открыть урок
                </Button>
              </Space>
              {user.studentMode === "direct" ? (
                <Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>
                  Порог блока: {directProgress?.threshold ?? 80}%.
                  {" "}
                  Текущий блок {active.moduleKey}: {directModuleStatus.get(active.moduleKey)?.avgScore ?? 0}%.
                </Paragraph>
              ) : null}
            </Card>
          ) : null}
          <List
            bordered
            loading={loading}
            dataSource={templates}
            locale={{ emptyText: "Пока нет опубликованных уроков" }}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    key="player"
                    type="primary"
                    size="small"
                    disabled={
                      user.studentMode === "direct" &&
                      (directModuleStatus.get(item.moduleKey)?.unlocked ?? true) === false
                    }
                    onClick={() => navigate(`/lesson/${encodeURIComponent(item.id)}`)}
                  >
                    Открыть урок
                  </Button>,
                ]}
              >
                <List.Item.Meta title={item.title} description={item.description ?? `Модуль: ${item.moduleKey}`} />
              </List.Item>
            )}
          />
        </Space>
        </div>
      </Card>
    </Space>
  );
}
