import { openDB } from "idb";
import type {
  ImageDataset,
  ImagePredictionInput,
  SavedModelEntry,
  TabularDatasetEntry,
  TabularPredictionInput
} from "@/shared/types/ai";
import type { NodlyProject, NodlyProjectMeta, NodlyProjectSnapshot } from "@/shared/types/project";
import { decodePersistedTraining } from "@/shared/decodePersistedTraining";
import {
  compactTabularDatasetEntries,
  materializeTabularDatasetEntries
} from "@/features/project/tabularSnapshotCodec";

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

interface StoredNodlyProject {
  meta: NodlyProjectMeta;
  snapshot: {
    imageDatasets: EncodedImageDataset[];
    tabularDatasets: TabularDatasetEntry[];
    imagePredictionInputs: EncodedImagePredictionInput[];
    tabularPredictionInputs: TabularPredictionInput[];
    savedModels?: SavedModelEntry[];
    blocklyState: string;
    workspaceLevel?: 1 | 2;
    persistedTraining?: NodlyProjectSnapshot["persistedTraining"];
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

function isEncodedFile(f: unknown): f is EncodedFile {
  return Boolean(
    f &&
      typeof f === "object" &&
      typeof (f as EncodedFile).dataUrl === "string" &&
      (f as EncodedFile).dataUrl.length > 0 &&
      typeof (f as EncodedFile).name === "string"
  );
}

async function decodeFileSafe(f: unknown): Promise<File | null> {
  if (!isEncodedFile(f)) {
    return null;
  }
  try {
    return await decodeFile(f);
  } catch {
    return null;
  }
}

async function decodeImageDatasetsSafe(items: unknown[]): Promise<ImageDataset[]> {
  return Promise.all(
    items.map(async (raw) => {
      const dataset = raw as EncodedImageDataset;
      return {
        id: dataset.id,
        title: dataset.title,
        taskType: dataset.taskType ?? "classification",
        classes: await Promise.all(
          (dataset.classes ?? []).map(async (datasetClass) => ({
            labelId: datasetClass.labelId,
            title: datasetClass.title,
            files: (await Promise.all((datasetClass.files ?? []).map((x) => decodeFileSafe(x)))).filter(
              (f): f is File => Boolean(f)
            )
          }))
        ),
        unlabeledFiles: dataset.unlabeledFiles?.length
          ? (await Promise.all(dataset.unlabeledFiles.map((x) => decodeFileSafe(x)))).filter(
              (f): f is File => Boolean(f)
            )
          : undefined
      };
    })
  );
}

async function decodeImageInputsSafe(items: unknown[]): Promise<ImagePredictionInput[]> {
  return Promise.all(
    items.map(async (raw) => {
      const item = raw as EncodedImagePredictionInput;
      const file = await decodeFileSafe(item.file);
      if (!file) {
        return { id: item.id, title: item.title, file: new File([], "missing.png", { type: "image/png" }) };
      }
      return { id: item.id, title: item.title, file };
    })
  );
}

function firstImageSampleFile(datasets: unknown[]): unknown | null {
  for (const raw of datasets) {
    const ds = raw as EncodedImageDataset;
    for (const c of ds.classes ?? []) {
      for (const f of c.files ?? []) {
        return f;
      }
    }
    for (const f of ds.unlabeledFiles ?? []) {
      return f;
    }
  }
  return null;
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

export async function saveProject(project: NodlyProject) {
  const db = await dbPromise;
  const stored: StoredNodlyProject = {
    meta: project.meta,
    snapshot: {
      imageDatasets: await encodeImageDatasets(project.snapshot.imageDatasets),
      tabularDatasets: await compactTabularDatasetEntries(project.snapshot.tabularDatasets),
      imagePredictionInputs: await encodeImageInputs(project.snapshot.imagePredictionInputs),
      tabularPredictionInputs: project.snapshot.tabularPredictionInputs,
      savedModels: project.snapshot.savedModels ?? [],
      blocklyState: project.snapshot.blocklyState,
      workspaceLevel: project.snapshot.workspaceLevel,
      ...(project.snapshot.persistedTraining !== undefined && project.snapshot.persistedTraining !== null
        ? { persistedTraining: project.snapshot.persistedTraining }
        : {})
    }
  };
  await db.put(STORE_NAME, stored);
}

export async function listProjectsByUser(userId: string): Promise<NodlyProjectMeta[]> {
  const db = await dbPromise;
  const all = (await db.getAll(STORE_NAME)) as StoredNodlyProject[];
  return all
    .map((item) => item.meta)
    .filter((meta) => meta.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(projectId: string): Promise<NodlyProject | null> {
  const db = await dbPromise;
  const stored = (await db.get(STORE_NAME, projectId)) as StoredNodlyProject | undefined;
  if (!stored) {
    return null;
  }
  const persistedTraining = decodePersistedTraining(
    (stored.snapshot as { persistedTraining?: unknown }).persistedTraining
  );
  const snapshot: NodlyProjectSnapshot = {
    imageDatasets: await decodeImageDatasets(stored.snapshot.imageDatasets),
    tabularDatasets: await materializeTabularDatasetEntries(stored.snapshot.tabularDatasets),
    imagePredictionInputs: await decodeImageInputs(stored.snapshot.imagePredictionInputs),
    tabularPredictionInputs: stored.snapshot.tabularPredictionInputs,
    savedModels: stored.snapshot.savedModels ?? [],
    blocklyState: stored.snapshot.blocklyState,
    workspaceLevel: stored.snapshot.workspaceLevel,
    ...(persistedTraining !== undefined ? { persistedTraining } : {})
  };
  return { meta: stored.meta, snapshot };
}

/** Сериализация снимка для JSON (облако): картинки как data URL, иначе File теряется. */
export async function encodeSnapshotForCloud(snapshot: NodlyProjectSnapshot): Promise<Record<string, unknown>> {
  return {
    imageDatasets: await encodeImageDatasets(snapshot.imageDatasets),
    tabularDatasets: await compactTabularDatasetEntries(snapshot.tabularDatasets),
    imagePredictionInputs: await encodeImageInputs(snapshot.imagePredictionInputs),
    tabularPredictionInputs: snapshot.tabularPredictionInputs,
    savedModels: snapshot.savedModels ?? [],
    blocklyState: snapshot.blocklyState,
    workspaceLevel: snapshot.workspaceLevel ?? 1,
    ...(snapshot.persistedTraining !== undefined && snapshot.persistedTraining !== null
      ? { persistedTraining: snapshot.persistedTraining }
      : {})
  };
}

export async function decodeSnapshotFromCloud(raw: unknown): Promise<NodlyProjectSnapshot> {
  const empty: NodlyProjectSnapshot = {
    imageDatasets: [],
    tabularDatasets: [],
    imagePredictionInputs: [],
    tabularPredictionInputs: [],
    savedModels: [],
    blocklyState: "",
    workspaceLevel: 1
  };
  if (!raw || typeof raw !== "object") {
    return empty;
  }
  const o = raw as Record<string, unknown>;
  const wlRaw = o.workspaceLevel;
  const rawNum =
    wlRaw === 1 || wlRaw === 2 || wlRaw === 3 ? wlRaw : wlRaw === "1" || wlRaw === "2" || wlRaw === "3"
      ? Number(wlRaw)
      : 1;
  const workspaceLevel: 1 | 2 = rawNum === 1 ? 1 : 2;
  const tabularDatasets = Array.isArray(o.tabularDatasets)
    ? (o.tabularDatasets as TabularDatasetEntry[])
    : [];
  const tabularPredictionInputs = Array.isArray(o.tabularPredictionInputs)
    ? (o.tabularPredictionInputs as TabularPredictionInput[])
    : [];
  const savedModels = Array.isArray(o.savedModels) ? (o.savedModels as SavedModelEntry[]) : [];
  const blocklyState = typeof o.blocklyState === "string" ? o.blocklyState : "";

  const idRaw = o.imageDatasets;
  let imageDatasets: ImageDataset[] = [];
  if (Array.isArray(idRaw) && idRaw.length > 0) {
    const firstFile = firstImageSampleFile(idRaw);
    if (isEncodedFile(firstFile)) {
      imageDatasets = await decodeImageDatasets(idRaw as EncodedImageDataset[]);
    } else {
      imageDatasets = await decodeImageDatasetsSafe(idRaw);
    }
  }

  const ipRaw = o.imagePredictionInputs;
  let imagePredictionInputs: ImagePredictionInput[] = [];
  if (Array.isArray(ipRaw) && ipRaw.length > 0) {
    const f = (ipRaw[0] as { file?: unknown })?.file;
    if (isEncodedFile(f)) {
      imagePredictionInputs = await decodeImageInputs(ipRaw as EncodedImagePredictionInput[]);
    } else {
      imagePredictionInputs = await decodeImageInputsSafe(ipRaw);
    }
  }

  const persistedTraining = decodePersistedTraining(o.persistedTraining);

  return {
    imageDatasets,
    tabularDatasets: await materializeTabularDatasetEntries(tabularDatasets),
    imagePredictionInputs,
    tabularPredictionInputs,
    savedModels,
    blocklyState,
    workspaceLevel,
    ...(persistedTraining !== undefined ? { persistedTraining } : {})
  };
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await dbPromise;
  await db.delete(STORE_NAME, projectId);
}
