import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
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
  published?: boolean;
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<{
    title: string;
    moduleKey: string;
    description?: string;
    published?: boolean;
  }>();

  const moduleTabs = [
    { key: "module_a", label: "Модуль A" },
    { key: "module_b", label: "Модуль B" },
    { key: "module_c", label: "Модуль C" },
    { key: "__other__", label: "Другие" }
  ] as const;

  const moduleLabel = (moduleKey: string) => {
    if (moduleKey === "module_a") {
      return "Модуль A";
    }
    if (moduleKey === "module_b") {
      return "Модуль B";
    }
    if (moduleKey === "module_c") {
      return "Модуль C";
    }
    return "Другие";
  };

  const tabByModule = (moduleKey: string) => {
    if (moduleKey === "module_a" || moduleKey === "module_b" || moduleKey === "module_c") {
      return moduleKey;
    }
    return "__other__";
  };

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
    {
      title: "Модуль",
      key: "module",
      width: 130,
      render: (_, row) => <Tag>{moduleLabel(row.moduleKey)}</Tag>
    },
    { title: "Название", dataIndex: "title", key: "title" },
    {
      title: "Описание",
      dataIndex: "description",
      key: "description",
      render: (v: string | null) => v ?? "—"
    },
    {
      title: "Статус",
      key: "published",
      width: 120,
      render: (_, row) => (row.published === false ? <Tag color="default">Черновик</Tag> : <Tag color="green">Опубликован</Tag>)
    },
    {
      title: "",
      key: "go",
      width: 340,
      render: (_, row) => (
        <Space wrap size="small">
          <Button type="link" onClick={() => navigate(`/admin/templates/${encodeURIComponent(row.id)}`)}>
            Открыть редактирование
          </Button>
          <Button type="link" onClick={() => navigate(`/lesson/${encodeURIComponent(row.id)}`)}>
            Открыть
          </Button>
          <Popconfirm
            title="Удалить урок?"
            description="Удаление необратимо. Урок пропадёт из каталога."
            okText="Удалить"
            cancelText="Отмена"
            onConfirm={async () => {
              setDeletingId(row.id);
              try {
                await apiClient.delete(`/api/admin/lesson-templates/${encodeURIComponent(row.id)}`);
                messageApi.success("Урок удалён");
                await load();
              } catch (e) {
                messageApi.error(e instanceof Error ? e.message : "Не удалось удалить урок");
              } finally {
                setDeletingId(null);
              }
            }}
          >
            <Button danger size="small" loading={deletingId === row.id}>
              Удалить
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const dataByTab = useMemo(() => {
    const grouped = new Map<string, LessonTemplateListItem[]>();
    for (const tab of moduleTabs) {
      grouped.set(tab.key, []);
    }
    for (const item of templates) {
      const key = tabByModule(item.moduleKey);
      const bucket = grouped.get(key) ?? [];
      bucket.push(item);
      grouped.set(key, bucket);
    }
    for (const arr of grouped.values()) {
      arr.sort((a, b) => a.title.localeCompare(b.title, "ru"));
    }
    return grouped;
  }, [templates]);

  return (
    <div className="app-content">
      {holder}
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <div>
          <Title level={4} style={{ marginTop: 0, marginBottom: 0 }}>
            Админ · Уроки
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Управление уроками по модулям: создание, редактирование, интерактивный просмотр и удаление.
          </Paragraph>
        </div>
        <Card
          title="Уроки"
          extra={
            <Button
              type="primary"
              onClick={() => {
                createForm.resetFields();
                createForm.setFieldsValue({ moduleKey: "module_a", published: true });
                setCreateOpen(true);
              }}
            >
              + Создать урок
            </Button>
          }
        >
          <Tabs
            items={moduleTabs.map((tab) => ({
              key: tab.key,
              label: tab.label,
              children: (
                <Table<LessonTemplateListItem>
                  size="small"
                  rowKey="id"
                  loading={loading}
                  dataSource={dataByTab.get(tab.key) ?? []}
                  columns={columns}
                  pagination={{ pageSize: 10 }}
                  locale={{ emptyText: "В этом модуле пока нет уроков" }}
                />
              )
            }))}
          />
        </Card>
      </Space>
      <Modal
        title="Новый урок"
        open={createOpen}
        onCancel={() => {
          if (!creating) {
            setCreateOpen(false);
          }
        }}
        onOk={() => createForm.submit()}
        okText="Создать"
        cancelText="Отмена"
        confirmLoading={creating}
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={async (vals) => {
            setCreating(true);
            try {
              const created = await apiClient.post<{ id: string }>("/api/admin/lesson-templates", {
                title: vals.title,
                description: vals.description,
                moduleKey: vals.moduleKey,
                sortOrder: 0,
                starterPayload: EMPTY_SNAPSHOT,
                published: vals.published ?? true,
                lessonContent: lessonContentFromBlocks([])
              });
              messageApi.success("Урок создан");
              setCreateOpen(false);
              await load();
              navigate(`/admin/templates/${encodeURIComponent(created.id)}`);
            } catch (e) {
              messageApi.error(e instanceof Error ? e.message : "Не удалось создать урок");
            } finally {
              setCreating(false);
            }
          }}
        >
          <Form.Item name="title" label="Название" rules={[{ required: true, message: "Введите название урока" }]}>
            <Input placeholder="Например: Введение в ИИ" />
          </Form.Item>
          <Form.Item name="moduleKey" label="Модуль" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "module_a", label: "Модуль A" },
                { value: "module_b", label: "Модуль B" },
                { value: "module_c", label: "Модуль C" },
                { value: "module_d", label: "Другие" }
              ]}
            />
          </Form.Item>
          <Form.Item name="description" label="Краткое описание">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="published" label="Опубликовать сразу" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

