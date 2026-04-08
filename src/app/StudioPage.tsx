import { useEffect, useState } from "react";
import { DatabaseOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Layout,
  List,
  Modal,
  Select,
  Space,
  Typography,
  message
} from "antd";
import { Link, useSearchParams } from "react-router-dom";
import { BlocklyWorkspace } from "@/features/blockly/BlocklyWorkspace";
import { DataLibrary } from "@/features/data/DataLibrary";
import { StudioStagePanel } from "@/app/StudioStagePanel";
import { useAppStore } from "@/store/useAppStore";
import type { NodlyProjectMeta, NodlyProjectSnapshot } from "@/shared/types/project";
import { loadProjectSmart, listProjects, saveProjectSmart } from "@/features/project/projectRepository";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";

const { Content } = Layout;
const { Paragraph, Text } = Typography;
const { TextArea } = Input;

const GUEST_USER_ID_KEY = "nodly_guest_user_id";
const LEGACY_GUEST_USER_ID_KEY = "noda_guest_user_id";
const DEFAULT_PROJECT_TITLE = "Новый проект";

const EMPTY_SNAPSHOT: NodlyProjectSnapshot = {
  imageDatasets: [],
  tabularDatasets: [],
  imagePredictionInputs: [],
  tabularPredictionInputs: [],
  savedModels: [],
  blocklyState: ""
};

interface SubmissionContext {
  assignmentId: string;
  assignmentTitle: string;
  classroomTitle: string;
  status: string;
  canSubmit: boolean;
  teacherNote: string | null;
  revisionNote: string | null;
  score: number | null;
  maxScore: number;
}

interface TeacherWorkReview {
  submissionId: string;
  status: string;
  score: number | null;
  maxScore: number;
  studentNickname: string;
  assignmentTitle: string;
  teacherNote: string | null;
  revisionNote: string | null;
}

interface TeacherWorkPayload {
  meta: NodlyProjectMeta;
  snapshot: NodlyProjectSnapshot;
  review: TeacherWorkReview;
}

const GRADEABLE_STATUSES = ["submitted", "needs_revision", "graded"] as const;

export function StudioPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [messageApi, contextHolder] = message.useMessage();
  const [guestUserId] = useState(() => {
    const stored =
      localStorage.getItem(GUEST_USER_ID_KEY) ?? localStorage.getItem(LEGACY_GUEST_USER_ID_KEY);
    if (stored) {
      if (!localStorage.getItem(GUEST_USER_ID_KEY)) {
        localStorage.setItem(GUEST_USER_ID_KEY, stored);
        localStorage.removeItem(LEGACY_GUEST_USER_ID_KEY);
      }
      return stored;
    }
    const next = `guest_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(GUEST_USER_ID_KEY, next);
    return next;
  });
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [dataLibraryOpen, setDataLibraryOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState(DEFAULT_PROJECT_TITLE);
  const [projectItems, setProjectItems] = useState<NodlyProjectMeta[]>([]);
  const [submittingAssignment, setSubmittingAssignment] = useState(false);
  const [submissionCtx, setSubmissionCtx] = useState<SubmissionContext | null>(null);
  const [teacherReview, setTeacherReview] = useState<TeacherWorkReview | null>(null);
  const [teacherGrading, setTeacherGrading] = useState(false);
  const [teacherGradeForm] = Form.useForm();
  const { getProjectSnapshot, loadProjectSnapshot, activeProject, setActiveProject } = useAppStore();
  const { user } = useSessionStore();
  const resolvedUserId = user?.id ?? guestUserId;
  const currentProjectTitle = activeProject?.title ?? DEFAULT_PROJECT_TITLE;
  const readOnly = Boolean(activeProject?.readOnly);

  const refreshProjects = async (nextUserId: string) => {
    const list = await listProjects(nextUserId.trim());
    setProjectItems(list);
  };

  useEffect(() => {
    void refreshProjects(resolvedUserId);
  }, [resolvedUserId]);

  useEffect(() => {
    if (!readOnly) {
      setTeacherReview(null);
      teacherGradeForm.resetFields();
    }
  }, [readOnly, teacherGradeForm]);

  useEffect(() => {
    if (!teacherReview) {
      return;
    }
    teacherGradeForm.setFieldsValue({
      decision: "grade",
      score: teacherReview.score ?? teacherReview.maxScore,
      comment: teacherReview.revisionNote || teacherReview.teacherNote || ""
    });
  }, [teacherReview?.submissionId, teacherGradeForm, teacherReview]);

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

  const reviewSubmissionId = searchParams.get("reviewSubmission");
  useEffect(() => {
    if (!reviewSubmissionId || user?.role !== "teacher") {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiClient.get<TeacherWorkPayload>(
          `/api/teacher/submissions/${encodeURIComponent(reviewSubmissionId)}/work`
        );
        if (cancelled) {
          return;
        }
        setActiveProject(data.meta);
        loadProjectSnapshot(data.snapshot);
        setSaveTitle(data.meta.title);
        setTeacherReview(data.review);
        messageApi.success("Открыта работа ученика");
        if (data.review.status === "submitted") {
          void apiClient
            .post("/api/teacher/submissions/mark-seen", { submissionIds: [data.review.submissionId] })
            .then(() => window.dispatchEvent(new Event("nodly-refresh-header-summary")))
            .catch(() => {});
        }
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("reviewSubmission");
            return next;
          },
          { replace: true }
        );
      } catch {
        if (!cancelled) {
          messageApi.error("Не удалось загрузить работу");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    reviewSubmissionId,
    user?.role,
    setSearchParams,
    setActiveProject,
    loadProjectSnapshot,
    messageApi
  ]);

  useEffect(() => {
    if (!user || user.role !== "student" || !activeProject?.id || activeProject.readOnly) {
      setSubmissionCtx(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await apiClient.get<SubmissionContext>(
          `/api/student/projects/${encodeURIComponent(activeProject.id)}/submission-context`
        );
        if (!cancelled) {
          setSubmissionCtx(ctx);
        }
      } catch {
        if (!cancelled) {
          setSubmissionCtx(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.role, user?.id, activeProject?.id, activeProject?.readOnly]);

  const submitTeacherGradeFromStudio = async () => {
    if (!teacherReview) {
      return;
    }
    setTeacherGrading(true);
    try {
      const v = await teacherGradeForm.validateFields();
      const raw = typeof v.comment === "string" ? v.comment.trim() : "";
      const comment = raw.length > 0 ? raw : null;
      await apiClient.post(`/api/teacher/submissions/${teacherReview.submissionId}/grade`, {
        decision: v.decision,
        score: v.decision === "grade" ? v.score : null,
        teacherNote: v.decision === "grade" ? comment : null,
        revisionNote: v.decision === "revision" ? comment : null
      });
      const data = await apiClient.get<TeacherWorkPayload>(
        `/api/teacher/submissions/${encodeURIComponent(teacherReview.submissionId)}/work`
      );
      setTeacherReview(data.review);
      window.dispatchEvent(new Event("nodly-refresh-header-summary"));
      messageApi.success("Решение сохранено");
    } catch (e) {
      if (e instanceof Error) {
        messageApi.error(e.message);
      }
    } finally {
      setTeacherGrading(false);
    }
  };

  const handleSave = async () => {
    if (readOnly) {
      messageApi.warning("Это просмотр работы ученика — сохранение отключено.");
      return;
    }
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
    setSubmissionCtx(null);
    messageApi.success("Черновик нового проекта. Сохрани, когда будет готово.");
  };

  const handleSubmitFromStudio = async () => {
    if (!submissionCtx?.canSubmit || !activeProject?.id || readOnly) {
      return;
    }
    setSubmittingAssignment(true);
    try {
      const normalizedUserId = resolvedUserId.trim();
      const now = new Date().toISOString();
      await saveProjectSmart({
        meta: {
          id: activeProject.id,
          userId: normalizedUserId,
          title: activeProject.title,
          createdAt: activeProject.createdAt,
          updatedAt: now
        },
        snapshot: getProjectSnapshot()
      });
      await apiClient.post(`/api/student/assignments/${submissionCtx.assignmentId}/submit`, {});
      messageApi.success("Работа сохранена и сдана учителю");
      window.dispatchEvent(new Event("nodly-refresh-header-summary"));
      const ctx = await apiClient.get<SubmissionContext>(
        `/api/student/projects/${encodeURIComponent(activeProject.id)}/submission-context`
      );
      setSubmissionCtx(ctx);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Не удалось сдать");
    } finally {
      setSubmittingAssignment(false);
    }
  };

  const teacherMessageForStudent =
    submissionCtx && (submissionCtx.revisionNote || submissionCtx.teacherNote)
      ? [submissionCtx.revisionNote, submissionCtx.teacherNote]
          .filter((x, i, a) => Boolean(x) && a.indexOf(x) === i)
          .join("\n\n")
      : "";

  const showTeacherGradePanel =
    readOnly &&
    teacherReview &&
    (GRADEABLE_STATUSES as readonly string[]).includes(teacherReview.status);

  return (
    <Content className="app-content app-content--workspace">
      {contextHolder}
      <div className="studio-page">
        <div className="studio-page__chrome">
          {readOnly && teacherReview ? (
            <Space direction="vertical" size="middle" style={{ width: "100%", marginBottom: 8 }}>
            <Alert
              type="info"
              showIcon
              message="Работа ученика"
              description={
                <span>
                  Проект ученика только для просмотра. Оценку и доработку можно оформить ниже. Раздел{" "}
                  <Link to="/teacher">кабинет учителя</Link> — для списка всех сдач.
                </span>
              }
            />
            {showTeacherGradePanel ? (
              <Card size="small" title={`Проверка: ${teacherReview.assignmentTitle} (${teacherReview.studentNickname})`}>
                <Paragraph type="secondary" style={{ marginTop: 0 }}>
                  Статус сдачи:{" "}
                  <Text strong>
                    {teacherReview.status === "submitted"
                      ? "сдано"
                      : teacherReview.status === "needs_revision"
                        ? "доработка"
                        : teacherReview.status === "graded"
                          ? `оценено (${teacherReview.score ?? "—"}/${teacherReview.maxScore})`
                          : teacherReview.status}
                  </Text>
                </Paragraph>
                <Form form={teacherGradeForm} layout="vertical">
                  <Form.Item name="decision" label="Решение">
                    <Select
                      options={[
                        { value: "grade", label: "Поставить оценку" },
                        { value: "revision", label: "Вернуть на доработку" }
                      ]}
                    />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(p, c) => p.decision !== c.decision}>
                    {({ getFieldValue }) =>
                      getFieldValue("decision") === "grade" ? (
                        <Form.Item
                          name="score"
                          label="Балл"
                          rules={[{ required: true }]}
                          extra={`0…${teacherReview.maxScore}`}
                        >
                          <InputNumber min={0} max={teacherReview.maxScore} style={{ width: "100%" }} />
                        </Form.Item>
                      ) : null
                    }
                  </Form.Item>
                  <Form.Item name="comment" label="Комментарий для ученика">
                    <TextArea rows={3} placeholder="Необязательно при оценке, желательно при доработке" />
                  </Form.Item>
                  <Button type="primary" loading={teacherGrading} onClick={() => void submitTeacherGradeFromStudio()}>
                    Сохранить решение
                  </Button>
                </Form>
              </Card>
            ) : (
              <Paragraph type="secondary">Ученик ещё не отправил работу на проверку (черновик).</Paragraph>
            )}
            </Space>
          ) : null}
          {!readOnly && submissionCtx ? (
          <Alert
            type={submissionCtx.status === "needs_revision" ? "warning" : "info"}
            showIcon
            message={
              <span>
                Задание: <strong>{submissionCtx.assignmentTitle}</strong> ({submissionCtx.classroomTitle})
              </span>
            }
            description={
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                {teacherMessageForStudent ? (
                  <div>
                    <Text strong>Сообщение учителя:</Text>
                    <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{teacherMessageForStudent}</Paragraph>
                  </div>
                ) : null}
                {submissionCtx.status === "graded" && submissionCtx.score != null ? (
                  <Text>
                    Оценка: {submissionCtx.score} / {submissionCtx.maxScore}
                  </Text>
                ) : null}
                {submissionCtx.canSubmit ? (
                  <Button type="primary" loading={submittingAssignment} onClick={() => void handleSubmitFromStudio()}>
                    Сохранить в облако и сдать учителю
                  </Button>
                ) : submissionCtx.status === "submitted" ? (
                  <Text type="secondary">Работа сдана, жди проверки.</Text>
                ) : null}
              </Space>
            }
          />
          ) : null}
        </div>
        <div className="studio-page__toolbar">
          <span className="studio-page__toolbar-title" title={currentProjectTitle}>
            {currentProjectTitle}
          </span>
          <Button
            type="primary"
            size="small"
            disabled={readOnly}
            onClick={() => {
              setSaveTitle(currentProjectTitle);
              setSaveOpen(true);
            }}
          >
            Сохранить
          </Button>
          <Button size="small" onClick={() => setLibraryOpen(true)}>
            Проекты
          </Button>
          <Button size="small" onClick={handleNewProject}>
            Новый
          </Button>
          <Button size="small" icon={<DatabaseOutlined />} onClick={() => setDataLibraryOpen(true)}>
            Данные
          </Button>
          {user && activeProject && !readOnly ? (
            <Button
              size="small"
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
              Поделиться
            </Button>
          ) : null}
        </div>
        <div className="studio-page__main">
          <div className="studio-page__blockly">
            <BlocklyWorkspace />
          </div>
          <StudioStagePanel />
        </div>
      </div>
      <Drawer
        title="Данные проекта"
        placement="right"
        width={580}
        open={dataLibraryOpen}
        onClose={() => setDataLibraryOpen(false)}
        destroyOnClose={false}
        rootClassName="studio-data-drawer"
      >
        <DataLibrary variant="drawer" />
      </Drawer>
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
        okButtonProps={{ disabled: readOnly }}
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
