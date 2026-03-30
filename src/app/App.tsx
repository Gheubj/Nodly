import { useEffect, useState } from "react";
import {
  Button,
  Drawer,
  Input,
  Layout,
  List,
  Space,
  Tabs,
  Typography,
  message
} from "antd";
import { BlocklyWorkspace } from "@/features/blockly/BlocklyWorkspace";
import { DataLibrary } from "@/features/data/DataLibrary";
import { useAppStore } from "@/store/useAppStore";
import type { NodaProjectMeta } from "@/shared/types/project";
import { listProjectsByUser, loadProject, saveProject } from "@/features/project/projectStorage";

const { Header, Content } = Layout;
const { Title, Paragraph } = Typography;
const USER_ID_KEY = "noda_user_id";

export function App() {
  const [messageApi, contextHolder] = message.useMessage();
  const [userId, setUserId] = useState(() => localStorage.getItem(USER_ID_KEY) ?? "student-1");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectItems, setProjectItems] = useState<NodaProjectMeta[]>([]);
  const { getProjectSnapshot, loadProjectSnapshot, activeProject, setActiveProject } = useAppStore();

  const refreshProjects = async (nextUserId: string) => {
    const list = await listProjectsByUser(nextUserId.trim());
    setProjectItems(list);
  };

  useEffect(() => {
    void refreshProjects(userId);
  }, [userId]);

  const handleSave = async () => {
    const normalizedUserId = userId.trim();
    const normalizedTitle = projectTitle.trim();
    if (!normalizedUserId || !normalizedTitle) {
      messageApi.error("Укажи user id и название проекта.");
      return;
    }
    const now = new Date().toISOString();
    const projectId = activeProject?.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await saveProject({
      meta: {
        id: projectId,
        userId: normalizedUserId,
        title: normalizedTitle,
        createdAt: activeProject?.createdAt ?? now,
        updatedAt: now
      },
      snapshot: getProjectSnapshot()
    });
    setActiveProject({
      id: projectId,
      userId: normalizedUserId,
      title: normalizedTitle,
      createdAt: activeProject?.createdAt ?? now,
      updatedAt: now
    });
    await refreshProjects(normalizedUserId);
    messageApi.success("Проект сохранен");
  };

  const handleLoadProject = async (projectId: string) => {
    const project = await loadProject(projectId);
    if (!project) {
      messageApi.error("Проект не найден");
      return;
    }
    setActiveProject(project.meta);
    loadProjectSnapshot(project.snapshot);
    setProjectTitle(project.meta.title);
    setLibraryOpen(false);
    messageApi.success(`Загружен проект: ${project.meta.title}`);
  };

  return (
    <Layout className="app-layout">
      {contextHolder}
      <Header className="app-header">
        <Title level={3} className="app-title">
          Noda PoC - AI в браузере
        </Title>
        <Space className="header-actions">
          <Input
            value={userId}
            onChange={(event) => {
              const nextValue = event.target.value;
              setUserId(nextValue);
              localStorage.setItem(USER_ID_KEY, nextValue);
            }}
            placeholder="user id"
            className="header-input"
          />
          <Input
            value={projectTitle}
            onChange={(event) => setProjectTitle(event.target.value)}
            placeholder="Название проекта"
            className="header-input"
          />
          <Button type="primary" onClick={() => void handleSave()}>
            Сохранить проект
          </Button>
          <Button onClick={() => setLibraryOpen(true)}>Библиотека проектов</Button>
        </Space>
      </Header>
      <Content className="app-content">
        <Paragraph className="placeholder-text">
          MVP Модуль A. Запуск только через блок Старт в Blockly.
        </Paragraph>
        <Tabs
          defaultActiveKey="workspace"
          items={[
            {
              key: "workspace",
              label: "Workspace",
              children: <BlocklyWorkspace />
            },
            {
              key: "library",
              label: "Библиотека",
              children: <DataLibrary />
            }
          ]}
        />
      </Content>
      <Drawer
        title={`Проекты пользователя: ${userId || "-"}`}
        open={libraryOpen}
        width={460}
        onClose={() => setLibraryOpen(false)}
      >
        <List
          dataSource={projectItems}
          locale={{ emptyText: "Проекты не найдены" }}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button key="load" type="link" onClick={() => void handleLoadProject(item.id)}>
                  Загрузить
                </Button>
              ]}
            >
              <List.Item.Meta
                title={item.title}
                description={`Обновлен: ${new Date(item.updatedAt).toLocaleString("ru-RU")}`}
              />
            </List.Item>
          )}
        />
      </Drawer>
    </Layout>
  );
}
