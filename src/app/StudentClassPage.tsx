import { useCallback, useEffect, useState } from "react";
import { Button, Card, Empty, Space, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link, useNavigate } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import { apiClient } from "@/shared/api/client";

const { Title, Paragraph, Text } = Typography;

interface StudentAssignmentRow {
  assignmentId: string;
  classroomId: string;
  classroomTitle: string;
  schoolName: string;
  title: string;
  kind: string;
  dueAt: string | null;
  maxScore: number;
  submission: {
    id: string;
    status: string;
    score: number | null;
    projectId: string | null;
    gradedSeenAt: string | null;
  } | null;
}

const STATUS_RU: Record<string, string> = {
  not_started: "Не начато",
  draft: "Черновик",
  submitted: "Сдано",
  needs_revision: "Нужна доработка",
  graded: "Оценено"
};

const KIND_RU: Record<string, string> = {
  classwork: "На уроке",
  homework: "Домашнее",
  project: "Проект"
};

function needsAttention(row: StudentAssignmentRow): boolean {
  const st = row.submission?.status ?? "not_started";
  if (st === "needs_revision") {
    return true;
  }
  if (st === "graded" && row.submission && !row.submission.gradedSeenAt) {
    return true;
  }
  return false;
}

export function StudentClassPage() {
  const { user } = useSessionStore();
  const [messageApi, contextHolder] = message.useMessage();
  const navigate = useNavigate();
  const enrollments = user?.enrollments ?? [];
  const [assignments, setAssignments] = useState<StudentAssignmentRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiClient.get<StudentAssignmentRow[]>("/api/student/assignments");
      setAssignments(list);
    } catch {
      setAssignments([]);
      messageApi.error("Не удалось загрузить задания");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    if (user?.role === "student" && user.studentMode === "school") {
      void loadAssignments();
    }
  }, [user?.role, user?.studentMode, loadAssignments]);

  const startOrOpen = async (row: StudentAssignmentRow) => {
    try {
      const res = await apiClient.post<{ projectId: string; submissionId: string; status: string }>(
        `/api/student/assignments/${row.assignmentId}/start`,
        {}
      );
      navigate(`/studio?project=${encodeURIComponent(res.projectId)}`);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const submitWork = async (row: StudentAssignmentRow) => {
    try {
      await apiClient.post(`/api/student/assignments/${row.assignmentId}/submit`, {});
      messageApi.success("Работа сдана");
      await loadAssignments();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const markGradedSeen = async (row: StudentAssignmentRow) => {
    const sid = row.submission?.id;
    if (!sid) {
      return;
    }
    try {
      await apiClient.post(`/api/student/submissions/${sid}/mark-graded-seen`, {});
      await loadAssignments();
    } catch {
      messageApi.error("Не удалось отметить просмотр");
    }
  };

  const assignmentColumns: ColumnsType<StudentAssignmentRow> = [
    {
      title: "Задание",
      key: "title",
      render: (_, row) => {
        const scoreSuffix =
          row.submission?.status === "graded" && row.submission.score != null
            ? ` (${row.submission.score}/${row.maxScore})`
            : "";
        return (
          <span>
            {row.title}
            {scoreSuffix}
          </span>
        );
      }
    },
    { title: "Класс", dataIndex: "classroomTitle", key: "classroomTitle" },
    {
      title: "Тип",
      dataIndex: "kind",
      key: "kind",
      render: (k: string) => KIND_RU[k] ?? k
    },
    {
      title: "Срок",
      dataIndex: "dueAt",
      key: "dueAt",
      render: (d: string | null) => (d ? new Date(d).toLocaleDateString("ru-RU") : "—")
    },
    {
      title: "Статус",
      key: "st",
      render: (_, row) => {
        const st = row.submission?.status ?? "not_started";
        const color =
          st === "needs_revision" ? "orange" : st === "graded" ? "green" : st === "submitted" ? "blue" : "default";
        return (
          <Space size="small" wrap>
            <Tag color={color}>{STATUS_RU[st] ?? st}</Tag>
            {needsAttention(row) ? <Tag color="red">Новое</Tag> : null}
          </Space>
        );
      }
    },
    {
      title: "",
      key: "actions",
      width: 300,
      render: (_, row) => {
        const st = row.submission?.status ?? "not_started";
        const hasProject = Boolean(row.submission?.projectId);
        return (
          <Space wrap size="small">
            {st === "not_started" || !row.submission ? (
              <Button type="primary" size="small" onClick={() => void startOrOpen(row)}>
                Начать
              </Button>
            ) : null}
            {(st === "draft" || st === "needs_revision") && hasProject ? (
              <Button size="small" onClick={() => void startOrOpen(row)}>
                Открыть в разработке
              </Button>
            ) : null}
            {(st === "draft" || st === "needs_revision") && hasProject ? (
              <Button size="small" type="default" onClick={() => void submitWork(row)}>
                Сдать
              </Button>
            ) : null}
            {st === "graded" && needsAttention(row) ? (
              <Button size="small" onClick={() => void markGradedSeen(row)}>
                Понятно
              </Button>
            ) : null}
          </Space>
        );
      }
    }
  ];

  if (!user) {
    return (
      <Empty description="Войдите, чтобы увидеть класс" image={Empty.PRESENTED_IMAGE_SIMPLE}>
        <Link to="/">На главную</Link>
      </Empty>
    );
  }

  if (enrollments.length === 0) {
    return (
      <Card>
        <Title level={5} style={{ marginTop: 0 }}>
          Ты ещё не в классе
        </Title>
        <Paragraph type="secondary">
          Попроси код у учителя и введи его в <Link to="/account">личном кабинете</Link> (раздел «Класс»).
        </Paragraph>
      </Card>
    );
  }

  const infoTab = (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {enrollments.map((e) => (
        <Card key={e.id} title={e.classroomTitle}>
          <Space direction="vertical" size="small">
            <div>
              <Text type="secondary">Школа / организация: </Text>
              <Text strong>{e.schoolName}</Text>
            </div>
            <div>
              <Text type="secondary">Учитель: </Text>
              <Text strong>{e.teacherNickname}</Text>
              <Text type="secondary"> ({e.teacherEmail})</Text>
            </div>
            <div>
              <Text type="secondary">Код класса (для одноклассников): </Text>
              <Text code>{e.classCode}</Text>
            </div>
          </Space>
        </Card>
      ))}
    </Space>
  );

  const assignmentsTab = (
    <Table<StudentAssignmentRow>
      size="small"
      rowKey="assignmentId"
      loading={loading}
      columns={assignmentColumns}
      dataSource={assignments}
      pagination={{ pageSize: 10 }}
      locale={{ emptyText: "Пока нет заданий" }}
    />
  );

  return (
    <>
      {contextHolder}
      <Tabs
        defaultActiveKey="assignments"
        items={[
          { key: "assignments", label: "Задания", children: assignmentsTab },
          { key: "info", label: "Мой класс", children: infoTab }
        ]}
      />
    </>
  );
}
