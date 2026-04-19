import { create } from "zustand";
import type {
  ImageDataset,
  ImagePredictionInput,
  ModelType,
  ModelEvaluation,
  PredictionResult,
  SavedModelEntry,
  TabularDataset,
  TabularDatasetEntry,
  TabularPredictionInput,
  TrainingRunReport,
  TrainingState
} from "@/shared/types/ai";
import type { NodlyProjectMeta, NodlyProjectSnapshot } from "@/shared/types/project";
import { decodePersistedTraining } from "@/shared/decodePersistedTraining";

export type WorkspaceLevel = 1 | 2;

const WORKSPACE_LEVEL_KEY = "nodly_workspace_level";
const LEGACY_WORKSPACE_LEVEL_KEY = "noda_workspace_level";

function clampWorkspaceLevel(n: number): WorkspaceLevel {
  if (n === 1) {
    return 1;
  }
  return 2;
}

function readWorkspaceLevel(): WorkspaceLevel {
  const raw =
    localStorage.getItem(WORKSPACE_LEVEL_KEY) ?? localStorage.getItem(LEGACY_WORKSPACE_LEVEL_KEY);
  if (raw === "1" || raw === "2" || raw === "3") {
    return clampWorkspaceLevel(Number(raw));
  }
  return 1;
}

function normalizeWorkspaceLevelFromSnapshot(value: unknown): WorkspaceLevel {
  if (value === 1 || value === 2 || value === 3) {
    return clampWorkspaceLevel(value as number);
  }
  if (value === "1" || value === "2" || value === "3") {
    return clampWorkspaceLevel(Number(value));
  }
  return 1;
}

interface AppState {
  activeProject: NodlyProjectMeta | null;
  imageDatasets: ImageDataset[];
  tabularDatasets: TabularDatasetEntry[];
  imagePredictionInputs: ImagePredictionInput[];
  tabularPredictionInputs: TabularPredictionInput[];
  savedModels: SavedModelEntry[];
  prediction: PredictionResult | null;
  evaluation: ModelEvaluation | null;
  trainingRunReport: TrainingRunReport | null;
  lastModelType: ModelType | null;
  blocklyState: string;
  workspaceLevel: WorkspaceLevel;
  training: TrainingState;
  /** Текст из блока «показать сообщение» за текущий прогон (приоритет над авто-подписью). */
  coachUserMessage: string | null;
  setCoachUserMessage: (value: string | null) => void;
  setActiveProject: (project: NodlyProjectMeta | null) => void;
  addImageDataset: (title: string, taskType: "classification" | "clustering") => string | null;
  addClassToImageDataset: (datasetId: string, title: string) => void;
  addSamplesToClass: (datasetId: string, labelId: string, files: File[]) => void;
  addUnlabeledSamplesToImageDataset: (datasetId: string, files: File[]) => void;
  clearUnlabeledSamples: (datasetId: string) => void;
  addTabularDataset: (title: string, dataset: TabularDataset) => void;
  addImagePredictionInput: (title: string, file: File) => void;
  addTabularPredictionInput: (title: string, input: string) => void;
  removeImageDataset: (id: string) => void;
  removeTabularDataset: (id: string) => void;
  removeImagePredictionInput: (id: string) => void;
  removeTabularPredictionInput: (id: string) => void;
  addSavedModel: (entry: SavedModelEntry) => void;
  removeSavedModel: (id: string) => void;
  setPrediction: (result: PredictionResult | null) => void;
  setEvaluation: (value: ModelEvaluation | null) => void;
  setTrainingRunReport: (value: TrainingRunReport | null) => void;
  setLastModelType: (modelType: ModelType | null) => void;
  setBlocklyState: (value: string) => void;
  getProjectSnapshot: () => NodlyProjectSnapshot;
  loadProjectSnapshot: (snapshot: NodlyProjectSnapshot) => void;
  setTraining: (state: Partial<TrainingState>) => void;
  setWorkspaceLevel: (level: WorkspaceLevel) => void;
}

const createLabelId = (title: string) =>
  title.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9а-я_]/gi, "");
const createId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const useAppStore = create<AppState>((set, get) => ({
  activeProject: null,
  imageDatasets: [],
  tabularDatasets: [],
  imagePredictionInputs: [],
  tabularPredictionInputs: [],
  savedModels: [],
  prediction: null,
  evaluation: null,
  trainingRunReport: null,
  lastModelType: null,
  blocklyState: "",
  workspaceLevel: readWorkspaceLevel(),
  coachUserMessage: null,
  training: {
    isTraining: false,
    progress: 0,
    message: "Ожидание",
    coachMood: "idle"
  },
  setCoachUserMessage: (value) => set({ coachUserMessage: value }),
  setActiveProject: (project) => set({ activeProject: project }),
  addImageDataset: (title, taskType) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return null;
    }
    const exists = get().imageDatasets.some((item) => item.title === normalizedTitle);
    if (exists) {
      return null;
    }
    const id = createId();
    set((state) => ({
      imageDatasets: [
        ...state.imageDatasets,
        {
          id,
          title: normalizedTitle,
          taskType,
          classes: [],
          ...(taskType === "clustering" ? { unlabeledFiles: [] } : {})
        }
      ]
    }));
    return id;
  },
  addClassToImageDataset: (datasetId, title) =>
    set((state) => ({
      imageDatasets: state.imageDatasets.map((dataset) => {
        if (dataset.id !== datasetId) {
          return dataset;
        }
        const normalizedTitle = title.trim();
        if (!normalizedTitle) {
          return dataset;
        }
        const labelId = createLabelId(normalizedTitle);
        const exists = dataset.classes.some((item) => item.labelId === labelId);
        if (exists) {
          return dataset;
        }
        return {
          ...dataset,
          classes: [...dataset.classes, { labelId, title: normalizedTitle, files: [] }]
        };
      })
    })),
  addSamplesToClass: (datasetId, labelId, files) =>
    set((state) => ({
      imageDatasets: state.imageDatasets.map((dataset) =>
        dataset.id !== datasetId
          ? dataset
          : {
              ...dataset,
              classes: dataset.classes.map((item) =>
                item.labelId === labelId ? { ...item, files: [...item.files, ...files] } : item
              )
            }
      )
    })),
  addUnlabeledSamplesToImageDataset: (datasetId, files) =>
    set((state) => ({
      imageDatasets: state.imageDatasets.map((dataset) =>
        dataset.id !== datasetId
          ? dataset
          : {
              ...dataset,
              unlabeledFiles: [...(dataset.unlabeledFiles ?? []), ...files]
            }
      )
    })),
  clearUnlabeledSamples: (datasetId) =>
    set((state) => ({
      imageDatasets: state.imageDatasets.map((dataset) =>
        dataset.id !== datasetId ? dataset : { ...dataset, unlabeledFiles: [] }
      )
    })),
  addTabularDataset: (title, dataset) =>
    set((state) => ({
      tabularDatasets: [...state.tabularDatasets, { id: createId(), title: title.trim(), dataset }]
    })),
  addImagePredictionInput: (title, file) =>
    set((state) => ({
      imagePredictionInputs: [...state.imagePredictionInputs, { id: createId(), title: title.trim(), file }]
    })),
  addTabularPredictionInput: (title, input) =>
    set((state) => ({
      tabularPredictionInputs: [
        ...state.tabularPredictionInputs,
        { id: createId(), title: title.trim(), input: input.trim() }
      ]
    })),
  removeImageDataset: (id) =>
    set((state) => ({
      imageDatasets: state.imageDatasets.filter((ds) => ds.id !== id)
    })),
  removeTabularDataset: (id) =>
    set((state) => ({
      tabularDatasets: state.tabularDatasets.filter((ds) => ds.id !== id)
    })),
  removeImagePredictionInput: (id) =>
    set((state) => ({
      imagePredictionInputs: state.imagePredictionInputs.filter((item) => item.id !== id)
    })),
  removeTabularPredictionInput: (id) =>
    set((state) => ({
      tabularPredictionInputs: state.tabularPredictionInputs.filter((item) => item.id !== id)
    })),
  addSavedModel: (entry) =>
    set((state) => ({
      savedModels: [...state.savedModels.filter((m) => m.id !== entry.id), entry]
    })),
  removeSavedModel: (id) =>
    set((state) => ({
      savedModels: state.savedModels.filter((m) => m.id !== id)
    })),
  setPrediction: (result) => set({ prediction: result }),
  setEvaluation: (value) => set({ evaluation: value }),
  setTrainingRunReport: (value) => set({ trainingRunReport: value }),
  setLastModelType: (modelType) => set({ lastModelType: modelType }),
  setBlocklyState: (value) => set({ blocklyState: value }),
  getProjectSnapshot: () => {
    const state = get();
    const hasPersisted =
      state.evaluation !== null ||
      state.trainingRunReport !== null ||
      state.prediction !== null;
    return {
      imageDatasets: state.imageDatasets,
      tabularDatasets: state.tabularDatasets,
      imagePredictionInputs: state.imagePredictionInputs,
      tabularPredictionInputs: state.tabularPredictionInputs,
      savedModels: state.savedModels,
      blocklyState: state.blocklyState,
      workspaceLevel: state.workspaceLevel,
      ...(hasPersisted
        ? {
            persistedTraining: {
              evaluation: state.evaluation,
              trainingRunReport: state.trainingRunReport,
              prediction: state.prediction
            }
          }
        : {})
    };
  },
  loadProjectSnapshot: (snapshot) => {
    const decoded = decodePersistedTraining(snapshot.persistedTraining);
    const evaluation = decoded?.evaluation ?? null;
    const trainingRunReport = decoded?.trainingRunReport ?? null;
    const prediction = decoded?.prediction ?? null;
    const hasResults = Boolean(evaluation || trainingRunReport || prediction);
    set({
      imageDatasets: snapshot.imageDatasets,
      tabularDatasets: snapshot.tabularDatasets,
      imagePredictionInputs: snapshot.imagePredictionInputs,
      tabularPredictionInputs: snapshot.tabularPredictionInputs,
      savedModels: snapshot.savedModels ?? [],
      blocklyState: snapshot.blocklyState,
      workspaceLevel: normalizeWorkspaceLevelFromSnapshot(snapshot.workspaceLevel),
      prediction,
      evaluation,
      trainingRunReport,
      coachUserMessage: null,
      training: {
        isTraining: false,
        progress: 0,
        message: hasResults ? "Результаты из сохранённого проекта" : "Проект загружен",
        coachMood: hasResults ? "success" : "talking"
      }
    });
  },
  setTraining: (nextState) =>
    set((state) => ({
      training: { ...state.training, ...nextState }
    })),
  setWorkspaceLevel: (level) => {
    const safe: WorkspaceLevel = level === 1 ? 1 : 2;
    try {
      localStorage.setItem(WORKSPACE_LEVEL_KEY, String(safe));
      localStorage.removeItem(LEGACY_WORKSPACE_LEVEL_KEY);
    } catch {
      /* ignore */
    }
    set({ workspaceLevel: safe });
  }
}));
