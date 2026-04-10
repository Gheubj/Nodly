import { Card, Spin, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "@/shared/api/client";

const { Text, Paragraph } = Typography;

type AssignmentPreviewRow = {
  assignmentId: string;
  classroomTitle: string;
  title: string;
  kind: string;
  dueAt: string | null;
  submission: { status: string } | null;
};

function needsHandIn(row: AssignmentPreviewRow): boolean {
  const st = row.submission?.status ?? "not_started";
  return st !== "submitted" && st !== "graded";
}

export function HomeUpcomingHomework() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AssignmentPreviewRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const list = await apiClient.get<AssignmentPreviewRow[]>("/api/student/assignments");
        if (!cancelled) {
          setRows(list);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
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
  }, []);

  const upcoming = useMemo(() => {
    const list = rows.filter(
      (r) => r.kind === "homework" && r.dueAt != null && needsHandIn(r)
    );
    list.sort((a, b) => dayjs(a.dueAt).valueOf() - dayjs(b.dueAt).valueOf());
    return list.slice(0, 4);
  }, [rows]);

  const nearest = upcoming[0];

  return (
    <Card className="landing-home-homework" title="Ближайшее ДЗ к сдаче" size="small">
      <Spin spinning={loading}>
        {nearest ? (
          <div>
            <Paragraph style={{ marginBottom: 8 }}>
              <Text strong>{nearest.title}</Text>
            </Paragraph>
            <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
              {nearest.classroomTitle}
            </Text>
            <Text
              type={dayjs(nearest.dueAt).endOf("day").isBefore(dayjs()) ? "danger" : "secondary"}
              style={{ fontSize: 12, display: "block", marginTop: 4 }}
            >
              Сдать до: {dayjs(nearest.dueAt).format("DD.MM.YYYY")}
              {dayjs(nearest.dueAt).endOf("day").isBefore(dayjs()) ? " · срок прошёл" : ""}
            </Text>
            {upcoming.length > 1 ? (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12 }}>
                {upcoming.slice(1).map((r) => (
                  <li key={r.assignmentId}>
                    <Text style={{ fontSize: 12 }}>
                      {r.title} — до {dayjs(r.dueAt).format("DD.MM")}
                    </Text>
                  </li>
                ))}
              </ul>
            ) : null}
            <Link to="/class" className="landing-home-homework__link">
              Открыть в Обучении
            </Link>
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 13 }}>
            Нет домашних заданий с дедлайном, которые сейчас нужно сдать. Загляни в{" "}
            <Link to="/class">Обучение</Link>, если ищешь классную работу или материалы курса.
          </Text>
        )}
      </Spin>
    </Card>
  );
}
