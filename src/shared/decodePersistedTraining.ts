import type { ModelEvaluation, PredictionResult, TrainingRunReport } from "@/shared/types/ai";

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === "object" && !Array.isArray(x));
}

/** Безопасный разбор поля снимка `persistedTraining` (облако / старые проекты). */
export function decodePersistedTraining(raw: unknown):
  | {
      evaluation: ModelEvaluation | null;
      trainingRunReport: TrainingRunReport | null;
      prediction: PredictionResult | null;
    }
  | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!isRecord(raw)) {
    return undefined;
  }
  const evaluationRaw = raw.evaluation;
  const reportRaw = raw.trainingRunReport;
  const predictionRaw = raw.prediction;

  const evaluation =
    evaluationRaw === null || evaluationRaw === undefined
      ? null
      : isRecord(evaluationRaw) && typeof evaluationRaw.summary === "string"
        ? (evaluationRaw as unknown as ModelEvaluation)
        : null;

  const trainingRunReport =
    reportRaw === null || reportRaw === undefined
      ? null
      : isRecord(reportRaw) &&
          typeof reportRaw.kind === "string" &&
          typeof reportRaw.modelType === "string" &&
          typeof reportRaw.summary === "string" &&
          isRecord(reportRaw.metrics) &&
          Array.isArray(reportRaw.epochHistory)
        ? (reportRaw as unknown as TrainingRunReport)
        : null;

  const prediction =
    predictionRaw === null || predictionRaw === undefined
      ? null
      : isRecord(predictionRaw) &&
          typeof predictionRaw.labelId === "string" &&
          typeof predictionRaw.title === "string" &&
          typeof predictionRaw.confidence === "number"
        ? (predictionRaw as unknown as PredictionResult)
        : null;

  if (
    evaluation === null &&
    trainingRunReport === null &&
    prediction === null &&
    evaluationRaw === undefined &&
    reportRaw === undefined &&
    predictionRaw === undefined
  ) {
    return undefined;
  }

  return { evaluation, trainingRunReport, prediction };
}
