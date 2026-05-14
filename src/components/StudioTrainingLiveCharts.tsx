import { useId, useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Typography } from "antd";
import { useAppStore } from "@/store/useAppStore";

const { Text } = Typography;

type StudioTrainingLiveChartsProps = {
  className?: string;
  compact?: boolean;
};

export function StudioTrainingLiveCharts({ className, compact }: StudioTrainingLiveChartsProps) {
  const training = useAppStore((s) => s.training);
  const liveEpochHistory = useAppStore((s) => s.liveEpochHistory);
  const streamModelType = useAppStore((s) => s.liveTrainingStreamModelType);

  const uid = useId().replace(/:/g, "");
  const chartHeight = compact ? 118 : 154;
  const margin = { top: 4, right: 4, left: 0, bottom: 0 };
  const axisTick = { fontSize: 9, fill: "rgba(148, 163, 184, 0.95)" };
  const gridStroke = "rgba(148, 163, 184, 0.16)";
  const tipStyle = {
    borderRadius: 10,
    border: "1px solid rgba(148, 163, 184, 0.28)",
    background: "color-mix(in srgb, var(--surface-floating, rgba(255,255,255,0.9)) 88%, transparent)",
    backdropFilter: "blur(10px)",
    fontSize: 11
  } as const;

  const rows = liveEpochHistory ?? [];
  const hasAcc = streamModelType !== "tabular_regression" && rows.some((r) => r.accuracy != null || r.valAccuracy != null);

  const chartRows = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        chartLoss: r.loss ?? r.mse,
        chartValLoss: r.valLoss ?? r.valMse
      })),
    [rows]
  );

  const show = training.isTraining && streamModelType != null && liveEpochHistory !== null;

  if (!show || !streamModelType) {
    return null;
  }

  return (
    <div
      className={["studio-training-live", compact ? "studio-training-live--compact" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="studio-training-live__charts studio-training-live__charts--loss-acc-only">
        <div className="studio-metrics-chart-shell studio-training-live__shell">
          <div className="studio-training-live__chart-head">
            <Text strong className="studio-training-live__chart-title">
              {streamModelType === "tabular_regression" ? "Loss (MSE)" : "Loss"}
            </Text>
            <div className="studio-training-live__legend" aria-hidden>
              <span className="studio-training-live__legend-item">
                <span className="studio-training-live__swatch studio-training-live__swatch--train" />
                <Text type="secondary">обучение</Text>
              </span>
              <span className="studio-training-live__legend-item">
                <span className="studio-training-live__swatch studio-training-live__swatch--val" />
                <Text type="secondary">валидация</Text>
              </span>
            </div>
          </div>
          <div className="studio-metrics-chart-shell__plot studio-metrics-line-chart">
            <ResponsiveContainer width="100%" height={chartHeight}>
              <LineChart data={chartRows} margin={margin}>
                <defs>
                  <linearGradient id={`${uid}-live-loss-tr`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#6aa3ff" />
                    <stop offset="100%" stopColor="#9d7bff" />
                  </linearGradient>
                  <linearGradient id={`${uid}-live-loss-val`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="100%" stopColor="#30d7d2" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 6" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="epoch" tick={axisTick} axisLine={false} tickLine={false} tickMargin={4} />
                <YAxis tick={axisTick} width={32} axisLine={false} tickLine={false} tickMargin={2} />
                <Tooltip
                  contentStyle={tipStyle}
                  labelFormatter={(epoch) => `Эпоха ${epoch}`}
                  formatter={(value: number | string, name: string) => {
                    const series = name === "train" ? "обучение" : name === "val" ? "валидация" : name;
                    const v =
                      typeof value === "number" && Number.isFinite(value) ? value.toFixed(4) : String(value);
                    return [v, series];
                  }}
                />
                <Line
                  isAnimationActive
                  animationDuration={280}
                  type="monotone"
                  dataKey="chartLoss"
                  name="train"
                  stroke={`url(#${uid}-live-loss-tr)`}
                  dot={false}
                  strokeWidth={2}
                  strokeLinecap="round"
                  connectNulls
                  legendType="none"
                />
                <Line
                  isAnimationActive
                  animationDuration={280}
                  type="monotone"
                  dataKey="chartValLoss"
                  name="val"
                  stroke={`url(#${uid}-live-loss-val)`}
                  dot={false}
                  strokeWidth={2}
                  strokeLinecap="round"
                  connectNulls
                  legendType="none"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {hasAcc ? (
          <div className="studio-metrics-chart-shell studio-training-live__shell">
            <div className="studio-training-live__chart-head">
              <Text strong className="studio-training-live__chart-title">
                Точность
              </Text>
              <div className="studio-training-live__legend" aria-hidden>
                <span className="studio-training-live__legend-item">
                  <span className="studio-training-live__swatch studio-training-live__swatch--train" />
                  <Text type="secondary">обучение</Text>
                </span>
                <span className="studio-training-live__legend-item">
                  <span className="studio-training-live__swatch studio-training-live__swatch--val" />
                  <Text type="secondary">валидация</Text>
                </span>
              </div>
            </div>
            <div className="studio-metrics-chart-shell__plot studio-metrics-line-chart">
              <ResponsiveContainer width="100%" height={chartHeight}>
                <LineChart data={rows} margin={margin}>
                  <defs>
                    <linearGradient id={`${uid}-live-acc-tr`} x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#9d7bff" />
                      <stop offset="100%" stopColor="#6aa3ff" />
                    </linearGradient>
                    <linearGradient id={`${uid}-live-acc-val`} x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#34d399" />
                      <stop offset="100%" stopColor="#5eead4" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="epoch" tick={axisTick} axisLine={false} tickLine={false} tickMargin={4} />
                  <YAxis domain={[0, 1]} tick={axisTick} width={32} axisLine={false} tickLine={false} tickMargin={2} />
                  <Tooltip
                    contentStyle={tipStyle}
                    labelFormatter={(epoch) => `Эпоха ${epoch}`}
                    formatter={(v: number | string, name: string) => {
                      const series = name === "train" ? "обучение" : name === "val" ? "валидация" : name;
                      if (typeof v === "number") {
                        return [`${(v * 100).toFixed(1)}%`, series];
                      }
                      return [String(v), series];
                    }}
                  />
                  <Line
                    isAnimationActive
                    animationDuration={280}
                    type="monotone"
                    dataKey="accuracy"
                    name="train"
                    stroke={`url(#${uid}-live-acc-tr)`}
                    dot={false}
                    strokeWidth={2}
                    strokeLinecap="round"
                    connectNulls
                    legendType="none"
                  />
                  <Line
                    isAnimationActive
                    animationDuration={280}
                    type="monotone"
                    dataKey="valAccuracy"
                    name="val"
                    stroke={`url(#${uid}-live-acc-val)`}
                    dot={false}
                    strokeWidth={2}
                    strokeLinecap="round"
                    connectNulls
                    legendType="none"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
