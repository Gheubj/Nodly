import { Button, Card, Popconfirm, Select, Space, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import "dayjs/locale/ru";

dayjs.extend(isoWeek);
dayjs.locale("ru");

const { Text } = Typography;

export type WeekScheduleSlot = {
  id: string;
  startsAt: string;
  durationMinutes: number;
  lessonTitle: string | null;
  notes: string | null;
  weeklySeriesId?: string | null;
  myPlansToAttend?: boolean | null;
};

type Props = {
  weekAnchor: Dayjs;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek?: () => void;
  slots: WeekScheduleSlot[];
  variant: "teacher" | "student";
  onDeleteSlot?: (slotId: string) => void;
  onDeleteSeries?: (seriesId: string) => void;
  onAttendanceChange?: (slotId: string, value: boolean | null) => void;
};

function dayKey(d: Dayjs) {
  return d.format("YYYY-MM-DD");
}

function slotTimeLabel(iso: string) {
  return dayjs(iso).format("HH:mm");
}

function slotStarted(iso: string) {
  return dayjs(iso).isBefore(dayjs());
}

export function WeekScheduleCalendar({
  weekAnchor,
  onPrevWeek,
  onNextWeek,
  onThisWeek,
  slots,
  variant,
  onDeleteSlot,
  onDeleteSeries,
  onAttendanceChange
}: Props) {
  const monday = weekAnchor.startOf("isoWeek");
  const days = Array.from({ length: 7 }, (_, i) => monday.add(i, "day"));

  const byDay = new Map<string, WeekScheduleSlot[]>();
  for (const s of slots) {
    const k = dayKey(dayjs(s.startsAt));
    const arr = byDay.get(k) ?? [];
    arr.push(s);
    byDay.set(k, arr);
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => dayjs(a.startsAt).valueOf() - dayjs(b.startsAt).valueOf());
  }

  const rangeLabel = `${monday.format("D MMM")} — ${monday.add(6, "day").format("D MMM YYYY")}`;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap align="center" className="week-schedule-toolbar">
        <Button type="default" onClick={onPrevWeek}>
          ← Неделя
        </Button>
        <Text strong style={{ minWidth: 200, textAlign: "center" }}>
          {rangeLabel}
        </Text>
        <Button type="default" onClick={onNextWeek}>
          Неделя →
        </Button>
        {onThisWeek ? (
          <Button type="link" onClick={onThisWeek}>
            Текущая неделя
          </Button>
        ) : null}
      </Space>
      <div className="week-schedule-grid">
        {days.map((d) => {
          const key = dayKey(d);
          const daySlots = byDay.get(key) ?? [];
          const title = d.format("dd D MMM");
          return (
            <Card key={key} size="small" className="week-schedule-day" title={title}>
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                {daySlots.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Нет занятий
                  </Text>
                ) : (
                  daySlots.map((slot) => (
                    <Card key={slot.id} size="small" className="week-schedule-slot" bordered>
                      <Space direction="vertical" size={4} style={{ width: "100%" }}>
                        <Text strong>
                          {slotTimeLabel(slot.startsAt)} · {slot.durationMinutes} мин
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {slot.lessonTitle ?? "Без темы урока"}
                        </Text>
                        {slot.notes ? (
                          <Text style={{ fontSize: 12 }} ellipsis>
                            {slot.notes}
                          </Text>
                        ) : null}
                        {variant === "teacher" && onDeleteSlot ? (
                          <Space size="small" wrap>
                            <Popconfirm
                              title="Удалить это занятие?"
                              okText="Удалить"
                              cancelText="Отмена"
                              onConfirm={() => onDeleteSlot(slot.id)}
                            >
                              <Button type="link" danger size="small" style={{ padding: 0, height: "auto" }}>
                                Удалить
                              </Button>
                            </Popconfirm>
                            {slot.weeklySeriesId && onDeleteSeries ? (
                              <Popconfirm
                                title="Удалить все занятия этой еженедельной серии?"
                                okText="Удалить все"
                                cancelText="Отмена"
                                onConfirm={() => onDeleteSeries(slot.weeklySeriesId!)}
                              >
                                <Button type="link" size="small" style={{ padding: 0, height: "auto" }}>
                                  Вся серия
                                </Button>
                              </Popconfirm>
                            ) : null}
                          </Space>
                        ) : null}
                        {variant === "student" && onAttendanceChange ? (
                          <div>
                            <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>
                              План на занятие (необязательно)
                            </Text>
                            <Select
                              size="small"
                              style={{ width: "100%" }}
                              disabled={slotStarted(slot.startsAt)}
                              value={
                                slot.myPlansToAttend === true
                                  ? "yes"
                                  : slot.myPlansToAttend === false
                                    ? "no"
                                    : "unset"
                              }
                              onChange={(v) =>
                                onAttendanceChange(slot.id, v === "unset" ? null : v === "yes")
                              }
                              options={[
                                { value: "unset", label: "Не отмечено" },
                                { value: "yes", label: "Планирую прийти" },
                                { value: "no", label: "Не смогу" }
                              ]}
                            />
                            {slotStarted(slot.startsAt) ? (
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                Занятие уже началось или прошло
                              </Text>
                            ) : null}
                          </div>
                        ) : null}
                      </Space>
                    </Card>
                  ))
                )}
              </Space>
            </Card>
          );
        })}
      </div>
    </Space>
  );
}
