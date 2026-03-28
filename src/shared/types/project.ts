import type {
  ImageDataset,
  ImagePredictionInput,
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
  blocklyState: string;
}

export interface NodaProject {
  meta: NodaProjectMeta;
  snapshot: NodaProjectSnapshot;
}
