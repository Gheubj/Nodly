import { Button, Card, List, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "@/shared/api/client";
import { useOpenLessonTemplate, type LessonTemplateListItem } from "@/hooks/useOpenLessonTemplate";

const { Paragraph, Text } = Typography;

type ProjectRow = { id: string; title: string; updatedAt: string };

export function HomeDirectStudentPanel() {
  const { openTemplate, openingId, contextHolder } = useOpenLessonTemplate();
  const [templates, setTemplates] = useState<LessonTemplateListItem[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [t, p] = await Promise.all([
          apiClient.get<LessonTemplateListItem[]>("/api/lesson-templates"),
          apiClient.get<ProjectRow[]>("/api/projects")
        ]);
        if (!cancelled) {
          setTemplates(t);
          setProjects(p);
        }
      } catch {
        if (!cancelled) {
          setTemplates([]);
          setProjects([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const topLessons = templates.slice(0, 3);
  const recentProjects = projects.slice(0, 3);

  return (
    <Card className="landing-home-direct" size="small" title="Ваше обучение">
      {contextHolder}
      <Spin spinning={loading}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
            Уроки из каталога и свои проекты в разработке. Полный список уроков — в разделе{" "}
            <Link to="/learning">Обучение</Link>.
          </Paragraph>
          {topLessons.length > 0 ? (
            <div>
              <Text strong style={{ fontSize: 13, display: "block", marginBottom: 8 }}>
                Начать с урока
              </Text>
              <List
                size="small"
                dataSource={topLessons}
                locale={{ emptyText: "Нет уроков" }}
                renderItem={(item) => (
                  <List.Item
                    style={{ paddingLeft: 0, paddingRight: 0 }}
                    actions={[
                      <Button
                        key="go"
                        type="primary"
                        size="small"
                        loading={openingId === item.id}
                        onClick={() => void openTemplate(item)}
                      >
                        Открыть
                      </Button>
                    ]}
                  >
                    <List.Item.Meta title={item.title} description={item.description ?? `Модуль ${item.moduleKey}`} />
                  </List.Item>
                )}
              />
            </div>
          ) : null}
          {recentProjects.length > 0 ? (
            <div>
              <Text strong style={{ fontSize: 13, display: "block", marginBottom: 8 }}>
                Недавние проекты
              </Text>
              <List
                size="small"
                dataSource={recentProjects}
                renderItem={(proj) => (
                  <List.Item style={{ paddingLeft: 0, paddingRight: 0 }}>
                    <Link to={`/studio?project=${encodeURIComponent(proj.id)}`}>{proj.title}</Link>
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                      {new Date(proj.updatedAt).toLocaleDateString("ru-RU")}
                    </Text>
                  </List.Item>
                )}
              />
            </div>
          ) : !loading ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Проектов пока нет — откройте урок выше или перейдите в{" "}
              <Link to="/studio">Разработку</Link>.
            </Text>
          ) : null}
          <Link to="/learning">
            <Button type="default" size="small">
              Все уроки каталога
            </Button>
          </Link>
        </Space>
      </Spin>
    </Card>
  );
}
