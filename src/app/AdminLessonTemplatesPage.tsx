import { useEffect, useState } from "react";
import { Button, Card, Form, Input, InputNumber, Space, Switch, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import { lessonContentFromBlocks } from "@/shared/lessonContentBlocks";

const { Title, Paragraph } = Typography;

type LessonTemplateListItem = {
  id: string;
  title: string;
  description: string | null;
  moduleKey: string;
  sortOrder: number;
};

const EMPTY_SNAPSHOT = {
  imageDatasets: [],
  tabularDatasets: [],
  imagePredictionInputs: [],
  tabularPredictionInputs: [],
  savedModels: [],
  blocklyState: ""
};

export function AdminLessonTemplatesPage() {
  const { user } = useSessionStore();
  const navigate = useNavigate();
  const [messageApi, holder] = message.useMessage();
  const [templates, setTemplates] = useState<LessonTemplateListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await apiClient.get<LessonTemplateListItem[]>("/api/lesson-templates");
      setTemplates(list);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось загрузить шаблоны");
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const columns: ColumnsType<LessonTemplateListItem> = [
    { title: "Порядок", dataIndex: "sortOrder", key: "sortOrder", width: 90 },
    { title: "Модуль", dataIndex: "moduleKey", key: "moduleKey", width: 140 },
    { title: "Название", dataIndex: "title", key: "title" },
    {
      title: "",
      key: "go",
      width: 180,
      render: (_, row) => (
        <Button type="link" onClick={() => navigate(`/admin/templates/${encodeURIComponent(row.id)}`)}>
          Открыть холст
        </Button>
      )
    }
  ];

  return (
    <div className="app-content">
      {holder}
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <div>
          <Title level={4} style={{ marginTop: 0, marginBottom: 0 }}>
            Шаблоны уроков
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Создай шаблон и сразу переходи в отдельную страницу-редактор (пустой холст) для сборки урока блоками.
          </Paragraph>
        </div>

        <Card title="Новый шаблон">
          <Form
            layout="vertical"
            style={{ maxWidth: 560 }}
            onFinish={async (vals: { title: string; moduleKey: string; sortOrder?: number; description?: string; published?: boolean }) => {
              setCreating(true);
              try {
                const created = await apiClient.post<{ id: string }>("/api/admin/lesson-templates", {
                  title: vals.title,
                  description: vals.description,
                  moduleKey: vals.moduleKey,
                  sortOrder: vals.sortOrder ?? 0,
                  starterPayload: EMPTY_SNAPSHOT,
                  published: vals.published ?? true,
                  lessonContent: lessonContentFromBlocks([])
                });
                messageApi.success("Шаблон создан");
                navigate(`/admin/templates/${encodeURIComponent(created.id)}`);
              } catch (e) {
                messageApi.error(e instanceof Error ? e.message : "Не удалось создать шаблон");
              } finally {
                setCreating(false);
              }
            }}
          >
            <Form.Item name="title" label="Название" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="moduleKey" label="Ключ модуля" initialValue="module_a" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="sortOrder" label="Порядок" initialValue={0}>
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="description" label="Описание">
              <Input />
            </Form.Item>
            <Form.Item name="published" label="Опубликован" valuePropName="checked" initialValue>
              <Switch />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={creating}>
              Создать и открыть холст
            </Button>
          </Form>
        </Card>

        <Card title="Существующие шаблоны">
          <Table<LessonTemplateListItem>
            size="small"
            rowKey="id"
            loading={loading}
            dataSource={templates}
            columns={columns}
            pagination={{ pageSize: 12 }}
          />
        </Card>
      </Space>
    </div>
  );
}

