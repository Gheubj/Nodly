import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Space, Spin, Typography, message } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import { AdminLessonBlockEditor } from "@/components/AdminLessonBlockEditor";
import { expandLessonContentToBlocks, lessonContentFromBlocks } from "@/shared/lessonContentBlocks";
import { EMPTY_LESSON_CONTENT, type LessonContentBlock } from "@/shared/types/lessonContent";

const { Title, Text, Paragraph } = Typography;

type TemplateContentPayload = {
  id: string;
  title: string;
  moduleKey: string;
  sortOrder: number;
  description: string | null;
  published: boolean;
  studentSummary: string | null;
  lessonContent: unknown;
};

export function AdminLessonTemplateEditorPage() {
  const { user } = useSessionStore();
  const navigate = useNavigate();
  const { templateId = "" } = useParams();
  const [messageApi, holder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<TemplateContentPayload | null>(null);
  const [blocks, setBlocks] = useState<LessonContentBlock[]>([]);

  const title = useMemo(() => template?.title ?? "Шаблон урока", [template?.title]);

  useEffect(() => {
    if (!templateId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const data = await apiClient.get<TemplateContentPayload>(
          `/api/admin/lesson-templates/${encodeURIComponent(templateId)}/content`
        );
        if (cancelled) {
          return;
        }
        setTemplate(data);
        const content =
          data.lessonContent && typeof data.lessonContent === "object"
            ? (data.lessonContent as { blocks?: unknown[] })
            : EMPTY_LESSON_CONTENT;
        setBlocks(expandLessonContentToBlocks(content as any));
      } catch (e) {
        if (!cancelled) {
          messageApi.error(e instanceof Error ? e.message : "Не удалось загрузить шаблон");
          setTemplate(null);
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
  }, [templateId, messageApi]);

  if (user?.role !== "admin") {
    return (
      <div className="app-content">
        {holder}
        <Card>
          <Paragraph>Раздел только для администратора.</Paragraph>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-content">
      {holder}
      <Spin spinning={loading || saving}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <div className="admin-lesson-editor__header">
            <Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
              {title}
            </Title>
            <Space wrap size={10}>
              <Button type="link" style={{ paddingInline: 0 }} onClick={() => navigate("/admin/templates")}>
                Назад
              </Button>
              <Alert type="warning" showIcon message="Не забудь сохранить изменения перед выходом." />
            </Space>
          </div>

          <div>
            <AdminLessonBlockEditor blocks={blocks} onChange={setBlocks} />
          </div>

          <Space>
            <Button
              type="primary"
              onClick={async () => {
                if (!templateId) {
                  return;
                }
                setSaving(true);
                try {
                  await apiClient.patch(`/api/admin/lesson-templates/${encodeURIComponent(templateId)}/content`, {
                    studentSummary: template?.studentSummary ?? null,
                    lessonContent: lessonContentFromBlocks(blocks)
                  });
                  messageApi.success("Шаблон сохранен");
                } catch (e) {
                  messageApi.error(e instanceof Error ? e.message : "Не удалось сохранить шаблон");
                } finally {
                  setSaving(false);
                }
              }}
            >
              Сохранить
            </Button>
            <Button onClick={() => navigate("/admin/templates")}>К списку шаблонов</Button>
            {template ? (
              <Text type="secondary">
                {template.moduleKey} · #{template.sortOrder}
              </Text>
            ) : null}
          </Space>
        </Space>
      </Spin>
    </div>
  );
}

