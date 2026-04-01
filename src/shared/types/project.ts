import type {
  ImageDataset,
  ImagePredictionInput,
  SavedModelEntry,
  TabularDatasetEntry,
  TabularPredictionInput
} from "@/shared/types/ai";

export interface NodaProjectMeta {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface NodaProjectSnapshot {
  imageDatasets: ImageDataset[];
  tabularDatasets: TabularDatasetEntry[];
  imagePredictionInputs: ImagePredictionInput[];
  tabularPredictionInputs: TabularPredictionInput[];
  /** Сохранённые модели: метаданные в проекте, веса в IndexedDB по id */
  savedModels?: SavedModelEntry[];
  blocklyState: string;
}

export interface NodaProject {
  meta: NodaProjectMeta;
  snapshot: NodaProjectSnapshot;
}
