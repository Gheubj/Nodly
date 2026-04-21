import type { ModelEvaluation, PredictionResult } from "@/shared/types/ai";

/** Короткая реплика персонажа, если нет блока «показать сообщение». */
export const COACH_AUTO_RESULTS_LEAD = "Вот результаты:";

export type CoachBriefLine = { key: string; label: string; value: string };

/** Краткие строки под пузырём (без дублирования длинного summary, если уже есть точность). */
export function buildCoachBriefLines(
  evaluation: ModelEvaluation | null,
  prediction: PredictionResult | null
): CoachBriefLine[] {
  const out: CoachBriefLine[] = [];
  if (evaluation?.metrics?.testAccuracy != null) {
    out.push({
      key: "acc",
      label: "Точность (тест)",
      value: `${(evaluation.metrics.testAccuracy * 100).toFixed(1)}%`
    });
  } else if (evaluation?.summary?.trim()) {
    out.push({ key: "sum", label: "Модель", value: evaluation.summary.trim() });
  }
  if (evaluation?.metrics?.macroF1 != null) {
    out.push({
      key: "f1",
      label: "F1 (macro)",
      value: `${(evaluation.metrics.macroF1 * 100).toFixed(1)}%`
    });
  }
  if (prediction) {
    const isRegressionPrediction = prediction.labelId === "regression_output";
    out.push({
      key: "pred",
      label: "Предсказание",
      value: isRegressionPrediction
        ? prediction.title
        : `${prediction.title} (${(prediction.confidence * 100).toFixed(0)}% уверенности)`
    });
  }
  return out;
}
