import { Card, Spin, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/shared/api/client";
import { useSessionStore } from "@/store/useSessionStore";

const { Text } = Typography;

const DAY_COUNT = 4;

export type SchedulePreviewSlot = {
  id: string;
  startsAt: string;
  endsAt?: string;
  durationMinutes: number;
  lessonTitle: string | null;
  notes: string | null;
  classroomTitle: string;
  classroomId: string;
};

type Props = {
  onSlotsLoaded?: (slots: SchedulePreviewSlot[]) => void;
};

export function HomeSchedulePreview({ onSlotsLoaded }: Props) {
  const { user } = useSessionStore();
  const showClassroomTitle = user?.role === "teacher";
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<SchedulePreviewSlot[]>([]);
  const onSlotsLoadedRef = useRef(onSlotsLoaded);
  onSlotsLoadedRef.current = onSlotsLoaded;

  const scheduleRefetchKey = useMemo(() => {
    if (!user) {
      return "";
    }
    if (user.role === "teacher") {
      return `t:${user.id}`;
    }
    if (user.role === "student" && user.studentMode === "school") {
      const ids = (user.enrollments ?? []).map((e) => e.classroomId).sort().join(",");
      return `s:${user.id}:${ids}`;
    }
    return `u:${user.id}`;
  }, [user]);

  useEffect(() => {
    if (!scheduleRefetchKey) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const data = await apiClient.get<{ slots: SchedulePreviewSlot[] }>("/api/me/schedule-preview");
        if (!cancelled) {
          setSlots(data.slots);
          onSlotsLoadedRef.current?.(data.slots);
        }
      } catch {
        if (!cancelled) {
          setSlots([]);
          onSlotsLoadedRef.current?.([]);
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
  }, [scheduleRefetchKey]);

  const columns = useMemo(() => {
    const start = dayjs().startOf("day");
    return Array.from({ length: DAY_COUNT }, (_, i) => start.add(i, "day"));
  }, []);

  const slotsByDay = useMemo(() => {
    const keys = new Set(columns.map((d) => d.format("YYYY-MM-DD")));
    const map = new Map<string, SchedulePreviewSlot[]>();
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

  const timeRange = (s: SchedulePreviewSlot) => {
    const end = s.endsAt
      ? dayjs(s.endsAt)
      : dayjs(s.startsAt).add(s.durationMinutes, "minute");
    return `${dayjs(s.startsAt).format("HH:mm")}–${end.format("HH:mm")}`;
  };

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
                        <Text
                          strong
                          style={{
                            fontSize: 13,
                            display: showClassroomTitle ? undefined : "block",
                            lineHeight: 1.35
                          }}
                        >
                          {timeRange(s)}
                        </Text>
                        {showClassroomTitle ? (
                          <Text type="secondary" style={{ fontSize: 11, display: "block" }}>
                            {s.classroomTitle}
                          </Text>
                        ) : null}
                        <Text
                          style={{
                            fontSize: 12,
                            display: showClassroomTitle ? undefined : "block",
                            marginTop: showClassroomTitle ? undefined : 4,
                            lineHeight: 1.35
                          }}
                        >
                          {s.lessonTitle ?? "Занятие"}
                        </Text>
                        {showClassroomTitle && s.notes ? (
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
