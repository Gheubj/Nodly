import { Card, Space, Spin, Typography } from "antd";
import type { SessionUser } from "@/store/useSessionStore";

const { Text } = Typography;

export type SchoolStudentSummary = {
  assignmentAttentionCount?: number;
  homeworkTodoCount?: number;
  homeworkOverdueCount?: number;
  homeworkDueSoonCount?: number;
  submittedPendingReviewCount?: number;
};

type Props = {
  user: SessionUser;
  summary: SchoolStudentSummary;
  summaryLoading: boolean;
};

export function HomeSchoolStudentWelcome({ user, summary, summaryLoading }: Props) {
  const nick = user.nickname?.trim() || "ученик";

  const parts: string[] = [];
  if (summary.homeworkOverdueCount && summary.homeworkOverdueCount > 0) {
    parts.push(`просрочено ДЗ: ${summary.homeworkOverdueCount}`);
  }
  if (summary.homeworkDueSoonCount && summary.homeworkDueSoonCount > 0) {
    parts.push(`срок в ближайшие дни: ${summary.homeworkDueSoonCount}`);
  }
  if (summary.submittedPendingReviewCount && summary.submittedPendingReviewCount > 0) {
    parts.push(`на проверке у учителя: ${summary.submittedPendingReviewCount}`);
  }
  if (summary.assignmentAttentionCount && summary.assignmentAttentionCount > 0) {
    parts.push(`нужно открыть оценку или доработку: ${summary.assignmentAttentionCount}`);
  }

  return (
    <Card className="landing-home-school-welcome" size="small" title={`Здравствуйте, ${nick}!`}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
            Сводка по домашним заданиям
          </Text>
          <Spin spinning={summaryLoading}>
            {parts.length > 0 ? (
              <Text style={{ fontSize: 13 }}>{parts.join(" · ")}</Text>
            ) : !summaryLoading ? (
              <Text type="secondary" style={{ fontSize: 13 }}>
                Всё в порядке — новых срочных задач нет. Полный список заданий — в разделе «Обучение».
              </Text>
            ) : null}
          </Spin>
        </div>
      </Space>
    </Card>
  );
}
