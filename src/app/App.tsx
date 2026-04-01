import { useEffect, useState } from "react";
import {
  Button,
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
import { UserOutlined } from "@ant-design/icons";
import { Link, Route, Routes } from "react-router-dom";
import { BlocklyWorkspace } from "@/features/blockly/BlocklyWorkspace";
import { DataLibrary } from "@/features/data/DataLibrary";
import { AccountPage } from "@/app/AccountPage";
import { useAppStore } from "@/store/useAppStore";
import type { NodaProjectMeta } from "@/shared/types/project";
import { loadProjectSmart, listProjects, saveProjectSmart } from "@/features/project/projectRepository";
import { useSessionStore } from "@/store/useSessionStore";
import { setAccessToken } from "@/shared/api/client";

const { Header, Content } = Layout;
const { Title, Paragraph } = Typography;
const USER_ID_KEY = "noda_user_id";

function WorkspaceHome() {
  return (
    <>
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
    </>
  );
}

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
  const [projectTitle, setProjectTitle] = useState("");
  const [projectItems, setProjectItems] = useState<NodaProjectMeta[]>([]);
  const { getProjectSnapshot, loadProjectSnapshot, activeProject, setActiveProject } = useAppStore();
  const { user, register, login, refreshMe } = useSessionStore();

  const refreshProjects = async (nextUserId: string) => {
    const list = await listProjects(nextUserId.trim());
    setProjectItems(list);
  };

  useEffect(() => {
    void useSessionStore.getState().restoreSession();
  }, []);

  useEffect(() => {
    void refreshProjects(userId);
  }, [userId]);

  useEffect(() => {
    if (user?.id) {
      setUserId(user.id);
      localStorage.setItem(USER_ID_KEY, user.id);
    }
  }, [user]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("access_token");
    if (token) {
      setAccessToken(token);
      void refreshMe();
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refreshMe]);

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

  return (
    <Layout className="app-layout">
      {contextHolder}
      <Header className={`app-header${user ? " app-header--authed" : ""}`}>
        <Title level={3} className="app-title">
          <Link to="/" className="app-title-link">
            Noda PoC - AI в браузере
          </Link>
        </Title>
        <Space className="header-actions">
          {!user ? (
            <>
              <Button type="primary" onClick={() => setAuthOpen(true)}>
                Войти / Регистрация
              </Button>
              <Button onClick={handleYandexLogin}>Войти через Яндекс</Button>
            </>
          ) : null}
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
        {user ? (
          <Link to="/account" className="app-header-account" aria-label="Личный кабинет">
            <Button
              type="text"
              size="large"
              icon={<UserOutlined className="app-header-account-icon" />}
              className="header-user-btn app-header-account-btn"
            />
          </Link>
        ) : null}
      </Header>
      <Routes>
        <Route
          path="/"
          element={
            <Content className="app-content">
              <WorkspaceHome />
            </Content>
          }
        />
        <Route path="/account" element={<AccountPage />} />
      </Routes>
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
