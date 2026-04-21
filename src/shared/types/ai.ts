export type LabelId = string;
export type ModelType =
  | "image_knn"
  | "tabular_regression"
  | "tabular_classification"
  | "tabular_neural"
  | "tabular_svm"
  | "tabular_random_forest"
  | "tabular_orchestrator";

export interface DatasetClass {
  labelId: LabelId;
  title: string;
  files: File[];
}

export interface ImageDataset {
  id: string;
  title: string;
  taskType: "classification" | "clustering";
  classes: DatasetClass[];
  /** Без учителя: все снимки в одном наборе (кластеризация) */
  unlabeledFiles?: File[];
}

export interface ClassDatasetStat {
  labelId: LabelId;
  title: string;
  sampleCount: number;
}

export interface PredictionResult {
  labelId: LabelId;
  title: string;
  confidence: number;
}

export interface TabularDataset {
  headers: string[];
  rows: string[][];
  /**
   * Индекс целевой колонки (0-based, по полной строке CSV после разбора).
   * Не задан — последняя колонка (как раньше).
   */
  targetColumnIndex?: number;
  /** Сжатые строки (gzip+base64) при сохранении больших таблиц; тогда `rows` пустой до распаковки. */
  rowsGzipBase64?: string;
  /** Число строк до сжатия — для UI, пока `rows` не распакованы. */
  tabularStoredRowCount?: number;
}

export interface TabularDatasetEntry {
  id: string;
  title: string;
  dataset: TabularDataset;
}

export interface ImagePredictionInput {
  id: string;
  title: string;
  file: File;
}

export interface TabularPredictionInput {
  id: string;
  title: string;
  input: string;
}

export type CoachMood = "idle" | "working" | "success" | "error";

export interface TrainingState {
  isTraining: boolean;
  progress: number;
  message: string;
  coachMood?: CoachMood;
  /** Идёт прогон Blockly после «Старт» — итоговый текст и метрики под пузырём только после завершения (success). */
  scenarioActive?: boolean;
}

export interface TrainConfig {
  trainSplit: number;
  valSplit: number;
  testSplit: number;
  epochs: number;
  learningRate: number;
}

export interface ModelEvaluation {
  summary: string;
  metrics: Record<string, number>;
}

/** Одна эпоха обучения (табличные модели с fit). */
export interface TrainingEpochLog {
  epoch: number;
  loss?: number;
  valLoss?: number;
  accuracy?: number;
  valAccuracy?: number;
  mse?: number;
  valMse?: number;
}

export interface ConfusionMatrixData {
  labels: string[];
  /** matrix[trueIndex][predIndex] — количество примеров */
  matrix: number[][];
}

export interface ClassificationExampleRow {
  trueLabel: string;
  predictedLabel: string;
  confidence: number;
}

export interface RegressionExampleRow {
  trueY: number;
  predictedY: number;
  absError: number;
}

export type TrainingRunKind =
  | "tabular_classification"
  | "tabular_regression"
  | "image_knn"
  | "image_clustering"
  | "none";

/** Расширенный отчёт для панели визуализации (опционально сохраняется в снимке проекта). */
export interface TrainingRunReport {
  kind: TrainingRunKind;
  modelType: ModelType;
  summary: string;
  metrics: Record<string, number>;
  epochHistory: TrainingEpochLog[];
  confusionMatrix?: ConfusionMatrixData;
  classificationExamples?: ClassificationExampleRow[];
  regressionExamples?: RegressionExampleRow[];
}

export interface TrainByModelTypeResult {
  evaluation: ModelEvaluation;
  report: TrainingRunReport;
}

/** Запись в библиотеке сохранённых моделей (веса в IndexedDB, метаданные в проекте). */
export interface SavedModelEntry {
  id: string;
  title: string;
  modelType: ModelType;
  createdAt: string;
}
