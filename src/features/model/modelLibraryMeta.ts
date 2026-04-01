import { openDB } from "idb";
import type { ModelType } from "@/shared/types/ai";

export type TabularFeatureSpecPersist =
  | { kind: "numeric" }
  | { kind: "categorical"; categories: string[] };

export type TabularModelLibraryPayload = {
  kind: "tabular";
  modelType: ModelType;
  tabularMode: "regression" | "classification";
  classIndexToLabel: string[];
  tabularFeatureSpecs: TabularFeatureSpecPersist[];
};

export type KnnModelLibraryPayload = {
  kind: "knn";
  extraLabels: Record<string, string>;
  dataset: Record<string, { shape: number[]; data: number[] }>;
};

export type ModelLibraryRecord = { id: string } & (TabularModelLibraryPayload | KnnModelLibraryPayload);

const DB_NAME = "noda-model-library-meta";
const STORE = "modelMeta";
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: "id" });
    }
  }
});

export async function putModelLibraryRecord(record: ModelLibraryRecord): Promise<void> {
  const db = await dbPromise;
  await db.put(STORE, record);
}

export async function getModelLibraryRecord(id: string): Promise<ModelLibraryRecord | undefined> {
  const db = await dbPromise;
  return db.get(STORE, id);
}

export async function deleteModelLibraryRecord(id: string): Promise<void> {
  const db = await dbPromise;
  await db.delete(STORE, id);
}
