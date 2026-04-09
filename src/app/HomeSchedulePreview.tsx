import { Card, Spin, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/shared/api/client";

const { Text } = Typography;

const DAY_COUNT = 4;

type PreviewSlot = {
  id: string;
  startsAt: string;
  durationMinutes: number;
  lessonTitle: string | null;
  notes: string | null;
  classroomTitle: string;
  classroomId: string;
};

export function HomeSchedulePreview() {
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<PreviewSlot[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const data = await apiClient.get<{ slots: PreviewSlot[] }>("/api/me/schedule-preview");
        if (!cancelled) {
          setSlots(data.slots);
        }
      } catch {
        if (!cancelled) {
          setSlots([]);
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

  const columns = useMemo(() => {
    const start = dayjs().startOf("day");
    return Array.from({ length: DAY_COUNT }, (_, i) => start.add(i, "day"));
  }, []);

  const slotsByDay = useMemo(() => {
    const keys = new Set(columns.map((d) => d.format("YYYY-MM-DD")));
    const map = new Map<string, PreviewSlot[]>();
    for (const k of keys) {
      map.set(k, []);
    }
    for (const s of slots) {
      const k = dayjs(s.startsAt).format("YYYY-MM-DD");
      if (!map.has(k)) {
        continue;
      }
      map.get(k)!.push(s);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => dayjs(a.startsAt).valueOf() - dayjs(b.startsAt).valueOf());
    }
    return map;
  }, [slots, columns]);

  const todayKey = dayjs().format("YYYY-MM-DD");

  return (
    <Card className="landing-home-schedule" title="Ближайшие занятия" size="small">
      <Spin spinning={loading}>
        <div className="landing-home-schedule__grid">
          {columns.map((d) => {
            const key = d.format("YYYY-MM-DD");
            const daySlots = slotsByDay.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className={`landing-home-schedule__day${isToday ? " landing-home-schedule__day--today" : ""}`}
              >
                <Text strong className="landing-home-schedule__day-title">
                  {isToday ? "Сегодня" : d.format("dd, D MMM")}
                </Text>
                <div className="landing-home-schedule__slots">
                  {daySlots.length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Нет занятий
                    </Text>
                  ) : (
                    daySlots.map((s) => (
                      <div key={s.id} className="landing-home-schedule__slot">
                        <Text strong style={{ fontSize: 13 }}>
                          {dayjs(s.startsAt).format("HH:mm")} · {s.durationMinutes} мин
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11, display: "block" }}>
                          {s.classroomTitle}
                        </Text>
                        <Text style={{ fontSize: 12 }}>{s.lessonTitle ?? "Занятие"}</Text>
                        {s.notes ? (
                          <Text type="secondary" ellipsis style={{ fontSize: 11, display: "block" }}>
                            {s.notes}
                          </Text>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Spin>
    </Card>
  );
}
