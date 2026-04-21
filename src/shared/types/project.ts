import type {
  ImageDataset,
  ImagePredictionInput,
  ModelComparisonReport,
  ModelEvaluation,
  PredictionResult,
  SavedModelEntry,
  TabularDatasetEntry,
  TabularPredictionInput,
  TrainingRunReport
} from "@/shared/types/ai";

export interface NodlyProjectMeta {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Просмотр работы ученика: без сохранения в облако этого проекта */
  readOnly?: boolean;
  reviewSubmissionId?: string;
}

export interface NodlyProjectSnapshot {
  imageDatasets: ImageDataset[];
  tabularDatasets: TabularDatasetEntry[];
  imagePredictionInputs: ImagePredictionInput[];
  tabularPredictionInputs: TabularPredictionInput[];
  /** Сохранённые модели: метаданные в проекте, веса в IndexedDB по id */
  savedModels?: SavedModelEntry[];
  blocklyState: string;
  /** Уровень палитры Blockly (1–3), в т.ч. для мини-студии без выбора у ученика */
  workspaceLevel?: 1 | 2;
  /**
   * Сохранённые результаты последнего обучения/предсказания (перезагрузка, облако, шаринг).
   * Не влияет на исполнение Blockly — только сцена и вкладка «Визуализация».
   */
  persistedTraining?: {
    evaluation: ModelEvaluation | null;
    trainingRunReport: TrainingRunReport | null;
    prediction: PredictionResult | null;
    modelComparisonReport?: ModelComparisonReport | null;
  } | null;
}

export interface NodlyProject {
  meta: NodlyProjectMeta;
  snapshot: NodlyProjectSnapshot;
}
