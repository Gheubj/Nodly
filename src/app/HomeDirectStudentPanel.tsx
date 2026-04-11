import { Button, Card, Space, Spin, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "@/shared/api/client";
import { useOpenLessonTemplate, type LessonTemplateListItem } from "@/hooks/useOpenLessonTemplate";

const { Paragraph, Text } = Typography;

type ProjectRow = {
  id: string;
  title: string;
  updatedAt: string;
  lessonTemplateId?: string | null;
  catalogLessonComplete?: boolean;
};

export type DirectLessonFocus =
  | { kind: "start"; template: LessonTemplateListItem }
  | { kind: "continue"; template: LessonTemplateListItem; projectId: string }
  | { kind: "all_done" }
  | { kind: "no_catalog" };

function projectsForTemplate(T: LessonTemplateListItem, projects: ProjectRow[]) {
  const byId = projects.filter((p) => p.lessonTemplateId === T.id);
  if (byId.length > 0) {
    return byId;
  }
  return projects.filter((p) => !p.lessonTemplateId && p.title === T.title);
}

export function pickDirectLessonFocus(
  templates: LessonTemplateListItem[],
  projects: ProjectRow[]
): DirectLessonFocus {
  if (templates.length === 0) {
    return { kind: "no_catalog" };
  }
  for (const T of templates) {
    const matches = projectsForTemplate(T, projects);
    if (matches.length === 0) {
      return { kind: "start", template: T };
    }
    const incomplete = matches.filter((p) => !p.catalogLessonComplete);
    if (incomplete.length > 0) {
      const best = [...incomplete].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )[0]!;
      return { kind: "continue", template: T, projectId: best.id };
    }
  }
  return { kind: "all_done" };
}

function normalizeLessonTemplatesList(raw: unknown): LessonTemplateListItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (x): x is LessonTemplateListItem =>
      typeof x === "object" &&
      x !== null &&
      typeof (x as LessonTemplateListItem).id === "string" &&
      typeof (x as LessonTemplateListItem).title === "string"
  );
}

async function fetchTemplatesAndProjects(): Promise<{
  templates: LessonTemplateListItem[];
  projects: ProjectRow[];
  templatesLoadFailed: boolean;
}> {
  let templates: LessonTemplateListItem[] = [];
  let templatesLoadFailed = false;
  try {
    const raw = await apiClient.get<unknown>("/api/lesson-templates");
    templates = normalizeLessonTemplatesList(raw);
  } catch {
    templates = [];
    templatesLoadFailed = true;
  }
  let projects: ProjectRow[] = [];
  try {
    const p = await apiClient.get<ProjectRow[]>("/api/projects");
    projects = Array.isArray(p) ? p : [];
  } catch {
    projects = [];
  }
  return { templates, projects, templatesLoadFailed };
}

export function HomeDirectStudentPanel() {
  const navigate = useNavigate();
  const [msg, msgHolder] = message.useMessage();
  const { openTemplate, openingId, contextHolder } = useOpenLessonTemplate();
  const [templates, setTemplates] = useState<LessonTemplateListItem[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingDone, setMarkingDone] = useState(false);
  const [templatesLoadFailed, setTemplatesLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { templates: t, projects: p, templatesLoadFailed: failed } = await fetchTemplatesAndProjects();
    setTemplates(t);
    setProjects(p);
    setTemplatesLoadFailed(failed);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const focus = useMemo(() => pickDirectLessonFocus(templates, projects), [templates, projects]);

  const handleMarkDone = useCallback(
    async (projectId: string) => {
      setMarkingDone(true);
      try {
        await apiClient.patch(`/api/projects/${projectId}/catalog-lesson`, {
          catalogLessonComplete: true
        });
        await load();
      } catch (e) {
        msg.error(e instanceof Error ? e.message : "Не удалось сохранить");
      } finally {
        setMarkingDone(false);
      }
    },
    [msg, load]
  );

  const title =
    focus.kind === "start"
      ? "Следующий урок"
      : focus.kind === "continue"
        ? "Текущий урок"
        : focus.kind === "all_done"
          ? "Каталог пройден"
          : "Обучение";

  return (
    <Card className="landing-home-direct" size="small" title={title}>
      {msgHolder}
      {contextHolder}
      <Spin spinning={loading}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {templatesLoadFailed ? (
            <Text type="danger" style={{ fontSize: 13 }}>
              Не удалось загрузить каталог уроков. Проверьте сеть и обновите страницу.
            </Text>
          ) : null}
          {focus.kind === "no_catalog" && !templatesLoadFailed ? (
            <Text type="secondary" style={{ fontSize: 13 }}>
              В каталоге пока нет уроков.
            </Text>
          ) : null}
          {focus.kind === "all_done" ? (
            <>
              <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
                Все уроки из каталога отмечены пройденными. Можно повторить любой урок в разделе{" "}
                <Link to="/learning">Обучение</Link> или открыть <Link to="/studio">Разработку</Link>.
              </Paragraph>
              <Link to="/learning">
                <Button type="default" size="small">
                  Каталог уроков
                </Button>
              </Link>
            </>
          ) : null}
          {focus.kind === "start" ? (
            <>
              <div>
                <Text strong style={{ fontSize: 15, display: "block", marginBottom: 4 }}>
                  {focus.template.title}
                </Text>
                {focus.template.description ? (
                  <Text type="secondary" style={{ fontSize: 13, display: "block" }}>
                    {focus.template.description}
                  </Text>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Модуль {focus.template.moduleKey}
                  </Text>
                )}
              </div>
              <Button
                type="primary"
                loading={openingId === focus.template.id}
                onClick={() => void openTemplate(focus.template)}
              >
                Начать урок
              </Button>
              <Link to="/learning">
                <Button type="link" size="small" style={{ paddingLeft: 0 }}>
                  Все уроки каталога
                </Button>
              </Link>
            </>
          ) : null}
          {focus.kind === "continue" ? (
            <>
              <div>
                <Text strong style={{ fontSize: 15, display: "block", marginBottom: 4 }}>
                  {focus.template.title}
                </Text>
                {focus.template.description ? (
                  <Text type="secondary" style={{ fontSize: 13, display: "block" }}>
                    {focus.template.description}
                  </Text>
                ) : null}
              </div>
              <Space wrap>
                <Button type="primary" onClick={() => navigate(`/studio?project=${encodeURIComponent(focus.projectId)}`)}>
                  Продолжить в разработке
                </Button>
                <Button
                  type="default"
                  loading={markingDone}
                  onClick={() => void handleMarkDone(focus.projectId)}
                >
                  Урок пройден
                </Button>
              </Space>
              <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
                После «Урок пройден» на главной появится следующий урок из каталога (по порядку).
              </Text>
              <Link to="/learning">
                <Button type="link" size="small" style={{ paddingLeft: 0 }}>
                  Все уроки каталога
                </Button>
              </Link>
            </>
          ) : null}
        </Space>
      </Spin>
    </Card>
  );
}
