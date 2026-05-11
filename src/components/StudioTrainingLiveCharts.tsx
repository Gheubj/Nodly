import { useId } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useAppStore } from "@/store/useAppStore";
import { StudioTrainingConceptBanner } from "@/components/StudioTrainingConceptBanner";
import { StudioTrainingProcessViz } from "@/components/StudioTrainingProcessViz";

type StudioTrainingLiveChartsProps = {
  className?: string;
  compact?: boolean;
};

export function StudioTrainingLiveCharts({ className, compact }: StudioTrainingLiveChartsProps) {
  const training = useAppStore((s) => s.training);
  const liveEpochHistory = useAppStore((s) => s.liveEpochHistory);
  const plannedEpochs = useAppStore((s) => s.liveTrainingPlannedEpochs);
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
  const isRegression = streamModelType === "tabular_regression";
  const hasAcc = !isRegression && rows.some((r) => r.accuracy != null || r.valAccuracy != null);

  const currentEpoch = rows.length > 0 ? rows[rows.length - 1]!.epoch : 0;
  const totalPlanned = plannedEpochs ?? currentEpoch;
  const epochProgressPct =
    totalPlanned > 0 ? Math.min(100, Math.round((currentEpoch / Math.max(totalPlanned, 1)) * 100)) : 0;

  const show = training.isTraining && streamModelType != null && liveEpochHistory !== null;

  if (!show || !streamModelType) {
    return null;
  }

  const swatchRow = (
    <div className="studio-training-live__swatches" aria-hidden>
      <span className="studio-training-live__swatch studio-training-live__swatch--train" />
      <span className="studio-training-live__swatch studio-training-live__swatch--val" />
    </div>
  );

  return (
    <div
      className={["studio-training-live", compact ? "studio-training-live--compact" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      aria-describedby="studio-training-concept"
    >
      <StudioTrainingConceptBanner compact={compact} />

      <div className="studio-training-live__header">
        <span className="studio-training-live__epoch-digits">
          {currentEpoch}/{Math.max(totalPlanned, 1)}
        </span>
      </div>

      <StudioTrainingProcessViz
        modelType={streamModelType}
        epochHistory={rows}
        warming={currentEpoch === 0}
        compact={compact}
      />

      <div className="studio-training-live__epoch-track" aria-hidden>
        <div className="studio-training-live__epoch-track-fill" style={{ width: `${epochProgressPct}%` }} />
      </div>

      <div className="studio-training-live__charts">
        <div className="studio-metrics-chart-shell studio-training-live__shell">
          {swatchRow}
          <div className="studio-metrics-chart-shell__plot studio-metrics-line-chart">
            <ResponsiveContainer width="100%" height={chartHeight}>
              <LineChart data={rows} margin={margin}>
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
                <Tooltip contentStyle={tipStyle} />
                <Line
                  isAnimationActive
                  animationDuration={280}
                  type="monotone"
                  dataKey="loss"
                  name="t"
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
                  dataKey="valLoss"
                  name="v"
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
            {swatchRow}
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
                    formatter={(v: number | string) => [typeof v === "number" ? `${(v * 100).toFixed(1)}%` : v, ""]}
                  />
                  <Line
                    isAnimationActive
                    animationDuration={280}
                    type="monotone"
                    dataKey="accuracy"
                    name="t"
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
                    name="v"
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

        {isRegression ? (
          <div className="studio-metrics-chart-shell studio-training-live__shell">
            {swatchRow}
            <div className="studio-metrics-chart-shell__plot studio-metrics-line-chart">
              <ResponsiveContainer width="100%" height={chartHeight}>
                <LineChart data={rows} margin={margin}>
                  <defs>
                    <linearGradient id={`${uid}-live-mse-tr`} x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#8b7ae8" />
                      <stop offset="100%" stopColor="#6aa3ff" />
                    </linearGradient>
                    <linearGradient id={`${uid}-live-mse-val`} x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#3db8b4" />
                      <stop offset="100%" stopColor="#5ec8b8" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="epoch" tick={axisTick} axisLine={false} tickLine={false} tickMargin={4} />
                  <YAxis tick={axisTick} width={36} axisLine={false} tickLine={false} tickMargin={2} />
                  <Tooltip contentStyle={tipStyle} />
                  <Line
                    isAnimationActive
                    animationDuration={280}
                    type="monotone"
                    dataKey="mse"
                    name="t"
                    stroke={`url(#${uid}-live-mse-tr)`}
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
                    dataKey="valMse"
                    name="v"
                    stroke={`url(#${uid}-live-mse-val)`}
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
