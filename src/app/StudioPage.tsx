import { useEffect, useState } from "react";
import { Button, Drawer, Input, Layout, List, Modal, Space, Tabs, Typography, message } from "antd";
import { useSearchParams } from "react-router-dom";
import { BlocklyWorkspace } from "@/features/blockly/BlocklyWorkspace";
import { DataLibrary } from "@/features/data/DataLibrary";
import { useAppStore } from "@/store/useAppStore";
import type { NodaProjectMeta, NodaProjectSnapshot } from "@/shared/types/project";
import { loadProjectSmart, listProjects, saveProjectSmart } from "@/features/project/projectRepository";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";

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

export function StudioPage() {
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState(DEFAULT_PROJECT_TITLE);
  const [projectItems, setProjectItems] = useState<NodaProjectMeta[]>([]);
  const { getProjectSnapshot, loadProjectSnapshot, activeProject, setActiveProject } = useAppStore();
  const { user } = useSessionStore();
  const resolvedUserId = user?.id ?? guestUserId;
  const currentProjectTitle = activeProject?.title ?? DEFAULT_PROJECT_TITLE;

  const refreshProjects = async (nextUserId: string) => {
    const list = await listProjects(nextUserId.trim());
    setProjectItems(list);
  };

  useEffect(() => {
    void refreshProjects(resolvedUserId);
  }, [resolvedUserId]);

  const projectFromUrl = searchParams.get("project");
  useEffect(() => {
    if (!projectFromUrl || !user) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const project = await loadProjectSmart(projectFromUrl);
      if (cancelled) {
        return;
      }
      if (!project) {
        messageApi.error("Проект не найден");
        return;
      }
      setActiveProject(project.meta);
      loadProjectSnapshot(project.snapshot);
      setSaveTitle(project.meta.title);
      messageApi.success(`Загружен проект: ${project.meta.title}`);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("project");
          return next;
        },
        { replace: true }
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [projectFromUrl, user?.id, setSearchParams, setActiveProject, loadProjectSnapshot, messageApi]);

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

  return (
    <Content className="app-content">
      {contextHolder}
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
          {user && activeProject ? (
            <Button
              onClick={() =>
                void (async () => {
                  try {
                    const { token } = await apiClient.post<{ token: string }>(
                      `/api/projects/${activeProject.id}/share-link`,
                      {}
                    );
                    const url = `${window.location.origin}/share/${token}`;
                    await navigator.clipboard.writeText(url);
                    messageApi.success("Ссылка для копии проекта скопирована");
                  } catch {
                    messageApi.error("Не удалось создать ссылку (сохрани проект в облако)");
                  }
                })()
              }
            >
              Поделиться копией
            </Button>
          ) : null}
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
