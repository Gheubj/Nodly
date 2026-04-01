import { openDB } from "idb";
import type {
  ImageDataset,
  ImagePredictionInput,
  SavedModelEntry,
  TabularDatasetEntry,
  TabularPredictionInput
} from "@/shared/types/ai";
import type { NodaProject, NodaProjectMeta, NodaProjectSnapshot } from "@/shared/types/project";

interface EncodedFile {
  name: string;
  type: string;
  dataUrl: string;
}

interface EncodedImageDatasetClass {
  labelId: string;
  title: string;
  files: EncodedFile[];
}

interface EncodedImageDataset {
  id: string;
  title: string;
  taskType: "classification" | "clustering";
  classes: EncodedImageDatasetClass[];
  unlabeledFiles?: EncodedFile[];
}

interface EncodedImagePredictionInput {
  id: string;
  title: string;
  file: EncodedFile;
}

interface StoredNodaProject {
  meta: NodaProjectMeta;
  snapshot: {
    imageDatasets: EncodedImageDataset[];
    tabularDatasets: TabularDatasetEntry[];
    imagePredictionInputs: EncodedImagePredictionInput[];
    tabularPredictionInputs: TabularPredictionInput[];
    savedModels?: SavedModelEntry[];
    blocklyState: string;
  };
}

const DB_NAME = "noda-projects-db";
const STORE_NAME = "projects";

const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: "meta.id" });
    }
  }
});

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });

async function encodeFile(file: File): Promise<EncodedFile> {
  return {
    name: file.name,
    type: file.type,
    dataUrl: await readFileAsDataUrl(file)
  };
}

async function decodeFile(file: EncodedFile): Promise<File> {
  const response = await fetch(file.dataUrl);
  const blob = await response.blob();
  return new File([blob], file.name, { type: file.type });
}

async function encodeImageDatasets(items: ImageDataset[]): Promise<EncodedImageDataset[]> {
  return Promise.all(
    items.map(async (dataset) => ({
      id: dataset.id,
      title: dataset.title,
      taskType: dataset.taskType,
      classes: await Promise.all(
        dataset.classes.map(async (datasetClass) => ({
          labelId: datasetClass.labelId,
          title: datasetClass.title,
          files: await Promise.all(datasetClass.files.map(encodeFile))
        }))
      ),
      unlabeledFiles:
        dataset.unlabeledFiles && dataset.unlabeledFiles.length > 0
          ? await Promise.all(dataset.unlabeledFiles.map(encodeFile))
          : undefined
    }))
  );
}

async function decodeImageDatasets(items: EncodedImageDataset[]): Promise<ImageDataset[]> {
  return Promise.all(
    items.map(async (dataset) => ({
      id: dataset.id,
      title: dataset.title,
      taskType: dataset.taskType ?? "classification",
      classes: await Promise.all(
        dataset.classes.map(async (datasetClass) => ({
          labelId: datasetClass.labelId,
          title: datasetClass.title,
          files: await Promise.all(datasetClass.files.map(decodeFile))
        }))
      ),
      unlabeledFiles: dataset.unlabeledFiles?.length
        ? await Promise.all(dataset.unlabeledFiles.map(decodeFile))
        : undefined
    }))
  );
}

async function encodeImageInputs(items: ImagePredictionInput[]): Promise<EncodedImagePredictionInput[]> {
  return Promise.all(
    items.map(async (item) => ({
      id: item.id,
      title: item.title,
      file: await encodeFile(item.file)
    }))
  );
}

async function decodeImageInputs(items: EncodedImagePredictionInput[]): Promise<ImagePredictionInput[]> {
  return Promise.all(
    items.map(async (item) => ({
      id: item.id,
      title: item.title,
      file: await decodeFile(item.file)
    }))
  );
}

export async function saveProject(project: NodaProject) {
  const db = await dbPromise;
  const stored: StoredNodaProject = {
    meta: project.meta,
    snapshot: {
      imageDatasets: await encodeImageDatasets(project.snapshot.imageDatasets),
      tabularDatasets: project.snapshot.tabularDatasets,
      imagePredictionInputs: await encodeImageInputs(project.snapshot.imagePredictionInputs),
      tabularPredictionInputs: project.snapshot.tabularPredictionInputs,
      savedModels: project.snapshot.savedModels ?? [],
      blocklyState: project.snapshot.blocklyState
    }
  };
  await db.put(STORE_NAME, stored);
}

export async function listProjectsByUser(userId: string): Promise<NodaProjectMeta[]> {
  const db = await dbPromise;
  const all = (await db.getAll(STORE_NAME)) as StoredNodaProject[];
  return all
    .map((item) => item.meta)
    .filter((meta) => meta.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(projectId: string): Promise<NodaProject | null> {
  const db = await dbPromise;
  const stored = (await db.get(STORE_NAME, projectId)) as StoredNodaProject | undefined;
  if (!stored) {
    return null;
  }
  const snapshot: NodaProjectSnapshot = {
    imageDatasets: await decodeImageDatasets(stored.snapshot.imageDatasets),
    tabularDatasets: stored.snapshot.tabularDatasets,
    imagePredictionInputs: await decodeImageInputs(stored.snapshot.imagePredictionInputs),
    tabularPredictionInputs: stored.snapshot.tabularPredictionInputs,
    savedModels: stored.snapshot.savedModels ?? [],
    blocklyState: stored.snapshot.blocklyState
  };
  return { meta: stored.meta, snapshot };
}
