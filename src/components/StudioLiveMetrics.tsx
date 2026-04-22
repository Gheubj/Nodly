import { Typography } from "antd";
import { useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import type { ModelEvaluation } from "@/shared/types/ai";

const { Text } = Typography;

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}

function pctLabel01(x: number): string {
  return `${(clamp01(x) * 100).toFixed(1)}%`;
}

function pickAccuracy(ev: ModelEvaluation | null): number | null {
  if (!ev?.metrics) {
    return null;
  }
  const m = ev.metrics;
  if (typeof m.testAccuracy === "number") {
    return clamp01(m.testAccuracy);
  }
  if (typeof m.accuracy === "number") {
    return clamp01(m.accuracy);
  }
  if (typeof m.valAccuracy === "number") {
    return clamp01(m.valAccuracy);
  }
  return null;
}

function pickF1(ev: ModelEvaluation | null): number | null {
  if (!ev?.metrics) {
    return null;
  }
  const m = ev.metrics;
  if (typeof m.macroF1 === "number") {
    return clamp01(m.macroF1);
  }
  if (typeof m.weightedF1 === "number") {
    return clamp01(m.weightedF1);
  }
  if (typeof m.f1 === "number") {
    return clamp01(m.f1);
  }
  return null;
}

function pickRmse(ev: ModelEvaluation | null): number | null {
  if (!ev?.metrics) {
    return null;
  }
  const m = ev.metrics;
  if (typeof m.testRMSE === "number") {
    return m.testRMSE;
  }
  if (typeof m.testRmse === "number") {
    return m.testRmse;
  }
  if (typeof m.rmse === "number") {
    return m.rmse;
  }
  return null;
}

function rmseToBarPortion(rmse: number): number {
  if (rmse <= 0) {
    return 1;
  }
  return clamp01(1 / (1 + rmse));
}

type MetricRow = {
  key: string;
  name: string;
  /** 0…1 для ширины заливки */
  fill: number;
  /** Подпись у полосы (только проценты / «качество» для RMSE) */
  pctLabel: string;
};

type StudioLiveMetricsProps = {
  className?: string;
  /** Мини-сцена: чуть мельче типографика и полосы */
  compact?: boolean;
};

/**
 * Метрики последнего обучения: название и проценты над полосой, ниже — только прогресс.
 */
export function StudioLiveMetrics({ className, compact }: StudioLiveMetricsProps) {
  const evaluation = useAppStore((s) => s.evaluation);
  const training = useAppStore((s) => s.training);

  const rows = useMemo((): MetricRow[] => {
    const ev = evaluation;
    const acc = pickAccuracy(ev);
    const f1 = pickF1(ev);
    const rmse = pickRmse(ev);

    if (acc != null && f1 != null) {
      return [
        { key: "acc", name: "accuracy", fill: acc, pctLabel: pctLabel01(acc) },
        { key: "f1", name: "f1", fill: f1, pctLabel: pctLabel01(f1) }
      ];
    }
    if (acc != null) {
      return [{ key: "acc", name: "accuracy", fill: acc, pctLabel: pctLabel01(acc) }];
    }
    if (f1 != null) {
      return [{ key: "f1", name: "f1", fill: f1, pctLabel: pctLabel01(f1) }];
    }
    if (rmse != null) {
      const fill = rmseToBarPortion(rmse);
      const q = Math.round(fill * 100);
      return [{ key: "rmse", name: "rmse (тест)", fill, pctLabel: `${q}%` }];
    }
    return [];
  }, [evaluation]);

  const rootClass = [
    "nodly-promo-metrics",
    "nodly-promo-metrics--scene-bars",
    "nodly-promo-metrics--live",
    compact ? "nodly-promo-metrics--live-compact" : "",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  if (training.isTraining) {
    return (
      <div className={`nodly-promo-metrics nodly-promo-metrics--scene-bars ${className ?? ""}`}>
        <Text type="secondary">Обучение…</Text>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={`nodly-promo-metrics nodly-promo-metrics--scene-bars nodly-promo-metrics--live-empty ${className ?? ""}`}>
        <Text type="secondary">Запусти обучение в Blockly — здесь появятся метрики модели.</Text>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      {rows.map((row) => {
        const w = Math.round(row.fill * 1000) / 10;
        return (
          <div key={row.key} className="nodly-promo-metrics__scene-row">
            <div className="nodly-promo-metrics__scene-name-row">
              <span className="nodly-promo-metrics__scene-name">{row.name}</span>
              <span className="nodly-promo-metrics__scene-pct-above">{row.pctLabel}</span>
            </div>
            <div className="nodly-promo-metrics__scene-meter-row">
              <div className="nodly-promo-metrics__meter nodly-promo-metrics__meter--scene">
                <span
                  className={`nodly-promo-metrics__meter-fill${
                    row.key === "f1" ? " nodly-promo-metrics__meter-fill--f1" : ""
                  }${row.key === "rmse" ? " nodly-promo-metrics__meter-fill--rmse" : ""}`}
                  style={{ width: `${w}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
