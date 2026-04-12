import { Card, List, Space, Spin, Typography } from "antd";
import { Link } from "react-router-dom";
import type { SessionEnrollment, SessionUser } from "@/store/useSessionStore";

const { Paragraph, Text } = Typography;

export type SchoolStudentSummary = {
  assignmentAttentionCount?: number;
  homeworkTodoCount?: number;
  homeworkOverdueCount?: number;
  submittedPendingReviewCount?: number;
};

type Props = {
  user: SessionUser;
  enrollments: SessionEnrollment[] | undefined;
  summary: SchoolStudentSummary;
  summaryLoading: boolean;
};

export function HomeSchoolStudentWelcome({ user, enrollments, summary, summaryLoading }: Props) {
  const list = enrollments ?? [];
  const nick = user.nickname?.trim() || "ученик";

  const parts: string[] = [];
  if (summary.homeworkOverdueCount && summary.homeworkOverdueCount > 0) {
    parts.push(
      `просроченных ДЗ: ${summary.homeworkOverdueCount} ${
        summary.homeworkOverdueCount === 1 ? "задание" : "заданий"
      }`
    );
  }
  if (summary.homeworkTodoCount && summary.homeworkTodoCount > 0) {
    parts.push(`активных ДЗ: ${summary.homeworkTodoCount}`);
  }
  if (summary.submittedPendingReviewCount && summary.submittedPendingReviewCount > 0) {
    parts.push(`на проверке: ${summary.submittedPendingReviewCount}`);
  }
  if (summary.assignmentAttentionCount && summary.assignmentAttentionCount > 0) {
    parts.push(`требуют внимания: ${summary.assignmentAttentionCount}`);
  }

  return (
    <Card className="landing-home-school-welcome" size="small" title={`Здравствуйте, ${nick}!`}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
          Ниже — ближайшие занятия и задания по классам. Полный дневник и работы на уроке — в разделе{" "}
          <Link to="/class">Обучение</Link>.
        </Paragraph>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
            Сводка
          </Text>
          <Spin spinning={summaryLoading}>
            {parts.length > 0 ? (
              <Text style={{ fontSize: 13 }}>{parts.join(" · ")}</Text>
            ) : !summaryLoading ? (
              <Text type="secondary" style={{ fontSize: 13 }}>
                Всё в порядке — новых срочных задач нет.
              </Text>
            ) : null}
          </Spin>
        </div>
        {list.length > 0 ? (
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
              Мои классы
            </Text>
            <List
              size="small"
              bordered
              dataSource={list}
              renderItem={(e) => (
                <List.Item style={{ padding: "8px 12px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ fontSize: 13, display: "block" }}>
                      {e.classroomTitle}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {e.schoolName}
                      {e.teacherNickname ? ` · ${e.teacherNickname}` : ""}
                    </Text>
                  </div>
                  <Link to="/class">Обучение</Link>
                </List.Item>
              )}
            />
          </div>
        ) : null}
      </Space>
    </Card>
  );
}
