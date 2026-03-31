import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Drawer,
  Input,
  Layout,
  List,
  Modal,
  Select,
  Space,
  Tabs,
  Typography,
  message
} from "antd";
import { BlocklyWorkspace } from "@/features/blockly/BlocklyWorkspace";
import { DataLibrary } from "@/features/data/DataLibrary";
import { useAppStore } from "@/store/useAppStore";
import type { NodaProjectMeta } from "@/shared/types/project";
import { loadProjectSmart, listProjects, saveProjectSmart } from "@/features/project/projectRepository";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";
import { setAccessToken } from "@/shared/api/client";

const { Header, Content } = Layout;
const { Title, Paragraph } = Typography;
const USER_ID_KEY = "noda_user_id";

export function App() {
  const [messageApi, contextHolder] = message.useMessage();
  const [userId, setUserId] = useState(() => localStorage.getItem(USER_ID_KEY) ?? "student-1");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"teacher" | "student">("student");
  const [studentMode, setStudentMode] = useState<"school" | "direct">("direct");
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [spriteCatalog, setSpriteCatalog] = useState<{ id: string; title: string }[]>([]);
  const [selectedSpriteId, setSelectedSpriteId] = useState<string>("");
  const [projectTitle, setProjectTitle] = useState("");
  const [projectItems, setProjectItems] = useState<NodaProjectMeta[]>([]);
  const { getProjectSnapshot, loadProjectSnapshot, activeProject, setActiveProject } = useAppStore();
  const { user, register, login, logout, refreshMe } = useSessionStore();

  const refreshProjects = async (nextUserId: string) => {
    const list = await listProjects(nextUserId.trim());
    setProjectItems(list);
  };

  useEffect(() => {
    void refreshProjects(userId);
  }, [userId]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("access_token");
    if (token) {
      setAccessToken(token);
      void refreshMe();
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refreshMe]);

  useEffect(() => {
    if (user) {
      void refreshProjects(user.id);
      void (async () => {
        try {
          const result = await apiClient.get<{ packs: { id: string; title: string }[] }>("/api/sprites");
          setSpriteCatalog(result.packs);
        } catch {
          setSpriteCatalog([]);
        }
      })();
    }
  }, [user]);

  const handleSave = async () => {
    const normalizedUserId = userId.trim();
    const normalizedTitle = projectTitle.trim();
    if (!normalizedUserId || !normalizedTitle) {
      messageApi.error("Укажи user id и название проекта.");
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
    setProjectTitle(project.meta.title);
    setLibraryOpen(false);
    messageApi.success(`Загружен проект: ${project.meta.title}`);
  };

  const handleAuth = async () => {
    try {
      if (isRegister) {
        await register({ email, password, role, studentMode, displayName });
      } else {
        await login(email, password);
      }
      setAuthOpen(false);
      messageApi.success("Вход выполнен");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Ошибка авторизации");
    }
  };

  const handleYandexLogin = () => {
    window.location.href = `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001"}/api/auth/yandex/start`;
  };

  const handleJoinClassroom = async () => {
    try {
      await apiClient.post("/api/classrooms/join", { code: joinCode });
      await refreshMe();
      messageApi.success("Класс подключен");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Не удалось подключиться");
    }
  };

  const handleSpriteSave = async () => {
    try {
      await apiClient.post("/api/me/sprite", { spritePackId: selectedSpriteId || undefined });
      await refreshMe();
      messageApi.success("Персонаж обновлен");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Ошибка сохранения персонажа");
    }
  };

  return (
    <Layout className="app-layout">
      {contextHolder}
      <Header className="app-header">
        <Title level={3} className="app-title">
          Noda PoC - AI в браузере
        </Title>
        <Space className="header-actions">
          {!user ? (
            <>
              <Button type="primary" onClick={() => setAuthOpen(true)}>
                Войти / Регистрация
              </Button>
              <Button onClick={handleYandexLogin}>Войти через Яндекс</Button>
            </>
          ) : (
            <>
              <Paragraph style={{ margin: 0 }}>
                {user.role === "teacher" ? "Учитель" : "Ученик"}: {user.email}
              </Paragraph>
              <Button onClick={() => void logout()}>Выйти</Button>
            </>
          )}
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
        {user ? (
          <Card size="small" style={{ marginBottom: 12 }}>
            <Space wrap>
              <Paragraph style={{ margin: 0 }}>
                Режим ученика: {user.studentMode === "school" ? "со школой" : "самостоятельный"}
              </Paragraph>
              {user.role === "student" && user.studentMode !== "school" ? (
                <>
                  <Input
                    placeholder="Код класса"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    style={{ width: 160 }}
                  />
                  <Button onClick={() => void handleJoinClassroom()}>Присоединиться</Button>
                </>
              ) : null}
              <Select
                style={{ minWidth: 220 }}
                placeholder="Выбор спрайта"
                value={selectedSpriteId || undefined}
                onChange={(v) => setSelectedSpriteId(v)}
                options={spriteCatalog.map((item) => ({ value: item.id, label: item.title }))}
                allowClear
              />
              <Button onClick={() => void handleSpriteSave()}>Сохранить персонажа</Button>
            </Space>
          </Card>
        ) : null}
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
      <Modal
        open={authOpen}
        title={isRegister ? "Регистрация" : "Вход"}
        onCancel={() => setAuthOpen(false)}
        onOk={() => void handleAuth()}
        okText={isRegister ? "Создать аккаунт" : "Войти"}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <Input.Password
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
          />
          {isRegister ? (
            <>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Имя"
              />
              <Select
                value={role}
                onChange={(v) => setRole(v)}
                options={[
                  { value: "student", label: "Ученик" },
                  { value: "teacher", label: "Учитель" }
                ]}
              />
              <Select
                value={studentMode}
                onChange={(v) => setStudentMode(v)}
                options={[
                  { value: "direct", label: "Ученик без учителя" },
                  { value: "school", label: "Ученик школы" }
                ]}
                disabled={role !== "student"}
              />
            </>
          ) : null}
          <Button type="link" onClick={() => setIsRegister((v) => !v)}>
            {isRegister ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
          </Button>
        </Space>
      </Modal>
    </Layout>
  );
}
