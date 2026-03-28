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
  classes: DatasetClass[];
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

export interface TrainingState {
  isTraining: boolean;
  progress: number;
  message: string;
}
