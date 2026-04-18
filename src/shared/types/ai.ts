export type LabelId = string;
export type ModelType =
  | "image_knn"
  | "tabular_regression"
  | "tabular_classification"
  | "tabular_neural";

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

/** Настроение персонажа-подсказчика в студии (в т.ч. мини-урок). */
export type CoachMood = "idle" | "working" | "talking" | "success" | "error";

export interface TrainingState {
  isTraining: boolean;
  progress: number;
  message: string;
  coachMood: CoachMood;
  /** Выполняется цепочка Blockly от «Старт» (не путать с isTraining модели). */
  isScriptRunning: boolean;
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

/** Запись в библиотеке сохранённых моделей (веса в IndexedDB, метаданные в проекте). */
export interface SavedModelEntry {
  id: string;
  title: string;
  modelType: ModelType;
  createdAt: string;
}
