import { useEffect, useMemo, useState } from "react";
import { Button, Drawer, Input, Layout, List, Modal, Space, Tabs, Typography, message } from "antd";
import { BlocklyWorkspace } from "@/features/blockly/BlocklyWorkspace";
import { DataLibrary } from "@/features/data/DataLibrary";
import { useAppStore } from "@/store/useAppStore";
import type { NodaProjectMeta, NodaProjectSnapshot } from "@/shared/types/project";
import { loadProjectSmart, listProjects, saveProjectSmart } from "@/features/project/projectRepository";
import { useSessionStore } from "@/store/useSessionStore";
import { StudentClassPage } from "@/app/StudentClassPage";
import { StudentLearningPage } from "@/app/StudentLearningPage";

const { Content } = Layout;
const { Paragraph, Text } = Typography;

const GUEST_USER_ID_KEY = "noda_guest_user_id";
const DEFAULT_PROJECT_TITLE = "Новый проект";

const EMPTY_SNAPSHOT: NodaProjectSnapshot = {
  imageDatasets: [],
  tabularDatasets: [],
  imagePredictionInputs: [],
  tabularPredictionInputs: [],
  savedModels: [],
  blocklyState: ""
};

export function HomePage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [guestUserId] = useState(() => {
    const stored = localStorage.getItem(GUEST_USER_ID_KEY);
    if (stored) {
      return stored;
    }
    const next = `guest_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(GUEST_USER_ID_KEY, next);
    return next;
  });
  const [mainTab, setMainTab] = useState("dev");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState(DEFAULT_PROJECT_TITLE);
  const [projectItems, setProjectItems] = useState<NodaProjectMeta[]>([]);
  const { getProjectSnapshot, loadProjectSnapshot, activeProject, setActiveProject } = useAppStore();
  const { user } = useSessionStore();
  const resolvedUserId = user?.id ?? guestUserId;
  const currentProjectTitle = activeProject?.title ?? DEFAULT_PROJECT_TITLE;

  const allowedTabs = useMemo(() => {
    const keys = ["dev"];
    if (user?.role === "student" && user.studentMode === "school") {
      keys.push("class");
    }
    if (user?.role === "student" && user.studentMode === "direct") {
      keys.push("learning");
    }
    return keys;
  }, [user]);

  useEffect(() => {
    if (!allowedTabs.includes(mainTab)) {
      setMainTab("dev");
    }
  }, [allowedTabs, mainTab]);

  const refreshProjects = async (nextUserId: string) => {
    const list = await listProjects(nextUserId.trim());
    setProjectItems(list);
  };

  useEffect(() => {
    void refreshProjects(resolvedUserId);
  }, [resolvedUserId]);

  const handleSave = async () => {
    const normalizedUserId = resolvedUserId.trim();
    const normalizedTitle = saveTitle.trim();
    if (!normalizedTitle) {
      messageApi.error("Укажи название проекта.");
      return;
    }
    const now = new Date().toISOString();
    const projectId = activeProject?.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await saveProjectSmart({
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
    setSaveOpen(false);
    messageApi.success("Проект сохранен");
  };

  const handleLoadProject = async (projectId: string) => {
    const project = await loadProjectSmart(projectId);
    if (!project) {
      messageApi.error("Проект не найден");
      return;
    }
    setActiveProject(project.meta);
    loadProjectSnapshot(project.snapshot);
    setLibraryOpen(false);
    messageApi.success(`Загружен проект: ${project.meta.title}`);
  };

  const handleNewProject = () => {
    setActiveProject(null);
    loadProjectSnapshot(EMPTY_SNAPSHOT);
    setSaveTitle(DEFAULT_PROJECT_TITLE);
    messageApi.success("Черновик нового проекта. Сохрани, когда будет готово.");
  };

  const developmentPanel = (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap align="center" style={{ width: "100%" }}>
        <Text strong style={{ maxWidth: 280 }} ellipsis={{ tooltip: currentProjectTitle }}>
          {currentProjectTitle}
        </Text>
        <Button
          type="primary"
          onClick={() => {
            setSaveTitle(currentProjectTitle);
            setSaveOpen(true);
          }}
        >
          Сохранить проект
        </Button>
        <Button onClick={() => setLibraryOpen(true)}>Мои проекты</Button>
        <Button onClick={handleNewProject}>Новый проект</Button>
      </Space>
      <Paragraph className="placeholder-text" style={{ marginBottom: 0 }}>
        MVP Модуль A. Запуск только через блок Старт в Blockly.
      </Paragraph>
      <Tabs
        defaultActiveKey="workspace"
        items={[
          { key: "workspace", label: "Workspace", children: <BlocklyWorkspace /> },
          { key: "library", label: "Библиотека", children: <DataLibrary /> }
        ]}
      />
    </Space>
  );

  const tabItems = [
    { key: "dev", label: "Разработка", children: developmentPanel },
    ...(user?.role === "student" && user.studentMode === "school"
      ? [{ key: "class", label: "Класс", children: <StudentClassPage /> }]
      : []),
    ...(user?.role === "student" && user.studentMode === "direct"
      ? [{ key: "learning", label: "Обучение", children: <StudentLearningPage /> }]
      : [])
  ];

  return (
    <Content className="app-content">
      {contextHolder}
      <Tabs activeKey={mainTab} onChange={setMainTab} items={tabItems} />
      <Drawer
        title={`Проекты: ${user?.nickname ?? "Черновик"}`}
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
      <Modal
        open={saveOpen}
        title="Сохранить проект"
        okText="Сохранить"
        onOk={() => void handleSave()}
        onCancel={() => setSaveOpen(false)}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} placeholder="Название проекта" />
        </Space>
      </Modal>
    </Content>
  );
}
