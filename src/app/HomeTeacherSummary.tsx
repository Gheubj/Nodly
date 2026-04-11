import { Alert, Button, Card, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "@/shared/api/client";
import { useSessionStore } from "@/store/useSessionStore";

const { Paragraph, Text } = Typography;

type TeacherDash = {
  schools: { id: string; name: string }[];
  classrooms: { id: string; title: string; schoolName: string }[];
};

type MeSummary = {
  pendingReviewCount?: number;
  newEnrollmentCount?: number;
};

export function HomeTeacherSummary() {
  const { user } = useSessionStore();
  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState<TeacherDash | null>(null);
  const [summary, setSummary] = useState<MeSummary>({});

  useEffect(() => {
    if (!user || user.role !== "teacher") {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [d, s] = await Promise.all([
          apiClient.get<TeacherDash>("/api/teacher/dashboard"),
          apiClient.get<MeSummary>("/api/me/summary")
        ]);
        if (!cancelled) {
          setDash(d);
          setSummary(s);
        }
      } catch {
        if (!cancelled) {
          setDash(null);
          setSummary({});
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user || user.role !== "teacher") {
    return null;
  }

  const schoolsCount = dash?.schools.length ?? 0;
  const classesCount = dash?.classrooms.length ?? 0;
  const pending = summary.pendingReviewCount ?? 0;
  const newEnroll = summary.newEnrollmentCount ?? 0;

  return (
    <Card className="landing-home-teacher-summary" size="small" title={`Здравствуйте, ${user.nickname || "коллега"}!`}>
      <Spin spinning={loading}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {schoolsCount === 0 && classesCount === 0 && !loading ? (
            <Alert
              type="info"
              showIcon
              message="Начните с организации"
              description={
                <Paragraph style={{ marginBottom: 0 }}>
                  Создайте школу или организацию и класс в{" "}
                  <Link to="/teacher">кабинете учителя</Link>, затем выдайте ученикам код для входа.
                </Paragraph>
              }
            />
          ) : null}
          {schoolsCount > 0 && classesCount === 0 && !loading ? (
            <Alert
              type="warning"
              showIcon
              message="Добавьте класс"
              description={
                <Paragraph style={{ marginBottom: 0 }}>
                  Школа есть, но пока нет классов. Создайте класс на вкладке «Классы и ученики» в{" "}
                  <Link to="/teacher">кабинете</Link>.
                </Paragraph>
              }
            />
          ) : null}
          <div>
            <Text type="secondary" style={{ fontSize: 13, display: "block", marginBottom: 8 }}>
              Сводка
            </Text>
            <Space wrap>
              <Text>
                <Text strong>{pending}</Text> работ на проверке
              </Text>
              <Text type="secondary">·</Text>
              <Text>
                <Text strong>{newEnroll}</Text> новых зачислений
              </Text>
            </Space>
            <div style={{ marginTop: 10 }}>
              <Link to="/teacher">
                <Button type="primary" size="small">
                  Открыть кабинет учителя
                </Button>
              </Link>
            </div>
          </div>
        </Space>
      </Spin>
    </Card>
  );
}
