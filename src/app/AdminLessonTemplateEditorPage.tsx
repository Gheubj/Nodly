import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Space, Spin, Typography, message } from "antd";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import { AdminLessonBlockEditor } from "@/components/AdminLessonBlockEditor";
import { LessonFlowView } from "@/components/LessonFlowView";
import { expandLessonContentToBlocks, lessonContentFromBlocks } from "@/shared/lessonContentBlocks";
import { EMPTY_LESSON_CONTENT, type LessonContentBlock } from "@/shared/types/lessonContent";

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

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
  const [studentSummary, setStudentSummary] = useState("");
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
        setStudentSummary(data.studentSummary ?? "");
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
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <div>
            <Title level={4} style={{ marginTop: 0, marginBottom: 0 }}>
              {title}
            </Title>
            <Space wrap>
              <Link to="/admin/templates">Назад к шаблонам</Link>
              <Link to="/">На главную</Link>
            </Space>
          </div>

          <Card title="Кратко для ученика">
            <TextArea
              rows={3}
              value={studentSummary}
              onChange={(e) => setStudentSummary(e.target.value)}
              placeholder="Краткое описание урока"
            />
            <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              Ниже — пустой холст урока. Добавляй блоки в нужном порядке.
            </Paragraph>
          </Card>

          <Card title="Холст урока">
            <AdminLessonBlockEditor blocks={blocks} onChange={setBlocks} />
          </Card>

          <Card title="Предпросмотр для ученика">
            <LessonFlowView
              blocks={blocks}
              checkpointOk={() => false}
              miniDevDone={() => false}
              draftAnswers={{}}
              onDraftChange={() => {}}
              onVerifyCheckpoint={() => {}}
              onToggleMiniDevDone={() => {}}
              saving={false}
            />
          </Card>

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
                    studentSummary: studentSummary.trim() || null,
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

