import type { ConfusionMatrixData } from "@/shared/types/ai";

export type PerClassMetricRow = {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
};

/** Метрики по классам и агрегаты из матрицы ошибок matrix[истинный][предсказанный]. */
export function metricsFromConfusionMatrix(cm: ConfusionMatrixData): {
  perClass: PerClassMetricRow[];
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  weightedPrecision: number;
  weightedRecall: number;
  weightedF1: number;
} {
  const { labels, matrix } = cm;
  const n = labels.length;
  if (n === 0) {
    return {
      perClass: [],
      macroPrecision: 0,
      macroRecall: 0,
      macroF1: 0,
      weightedPrecision: 0,
      weightedRecall: 0,
      weightedF1: 0
    };
  }

  const supports = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const total = supports.reduce((a, b) => a + b, 0) || 1;

  const perClass: PerClassMetricRow[] = [];
  const precisions: number[] = [];
  const recalls: number[] = [];
  const f1s: number[] = [];

  for (let c = 0; c < n; c++) {
    const tp = matrix[c][c] ?? 0;
    let colSum = 0;
    for (let i = 0; i < n; i++) {
      colSum += matrix[i][c] ?? 0;
    }
    const rowSum = supports[c];
    const precision = colSum > 0 ? tp / colSum : 0;
    const recall = rowSum > 0 ? tp / rowSum : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    precisions.push(precision);
    recalls.push(recall);
    f1s.push(f1);
    perClass.push({
      label: labels[c],
      precision,
      recall,
      f1,
      support: rowSum
    });
  }

  const macroPrecision = precisions.reduce((a, b) => a + b, 0) / n;
  const macroRecall = recalls.reduce((a, b) => a + b, 0) / n;
  const macroF1 = f1s.reduce((a, b) => a + b, 0) / n;

  let weightedPrecision = 0;
  let weightedRecall = 0;
  let weightedF1 = 0;
  for (let c = 0; c < n; c++) {
    const w = supports[c] / total;
    weightedPrecision += w * precisions[c];
    weightedRecall += w * recalls[c];
    weightedF1 += w * f1s[c];
  }

  return {
    perClass,
    macroPrecision,
    macroRecall,
    macroF1,
    weightedPrecision,
    weightedRecall,
    weightedF1
  };
}

/** Плоский объект для слияния в `report.metrics` (числа 0–1). */
export function flatAggregateMetrics(cm: ConfusionMatrixData): Record<string, number> {
  const m = metricsFromConfusionMatrix(cm);
  return {
    macroPrecision: m.macroPrecision,
    macroRecall: m.macroRecall,
    macroF1: m.macroF1,
    weightedPrecision: m.weightedPrecision,
    weightedRecall: m.weightedRecall,
    weightedF1: m.weightedF1
  };
}
