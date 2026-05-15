import type { TabularDataset, TabularDatasetEntry } from "@/shared/types/ai";
import type { NodlyProjectSnapshot } from "@/shared/types/project";

const IRIS_ENTRY_ID = "tabular_seed_iris_csv";
const IRIS_LAB_ENTRY_ID = "tabular_seed_iris_lab_csv";

/** `public/Iris.csv`: без строки заголовка, пять колонок через запятую, метка — последняя. */
export function tabularEntryFromIrisCsvText(text: string): TabularDatasetEntry | null {
  const headers = ["sepal_length", "sepal_width", "petal_length", "petal_width", "species"];
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => line.split(",").map((c) => c.trim()))
    .filter((r) => r.length >= 5);
  if (rows.length === 0) {
    return null;
  }
  const dataset: TabularDataset = {
    headers,
    rows,
    targetColumnIndex: 4
  };
  return { id: IRIS_ENTRY_ID, title: "Iris (Iris.csv)", dataset };
}

/** `public/Iris_lab_greenhouse.csv`: те же колонки, что у Iris; метка — последняя. */
export function tabularEntryFromIrisLabCsvText(text: string): TabularDatasetEntry | null {
  const headers = ["sepal_length", "sepal_width", "petal_length", "petal_width", "species"];
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => line.split(",").map((c) => c.trim()))
    .filter((r) => r.length >= 5);
  if (rows.length === 0) {
    return null;
  }
  const dataset: TabularDataset = {
    headers,
    rows,
    targetColumnIndex: 4
  };
  return { id: IRIS_LAB_ENTRY_ID, title: "Оранжерея лаборатории (50 цветков)", dataset };
}

/** Добавляет лабораторный CSV к снимку квеста, если его ещё нет. */
export async function ensureIrisQuestLabDatasetInSnapshot(
  snapshot: NodlyProjectSnapshot
): Promise<NodlyProjectSnapshot> {
  if (snapshot.tabularDatasets.some((e) => e.id === IRIS_LAB_ENTRY_ID)) {
    return snapshot;
  }
  try {
    const res = await fetch("/Iris_lab_greenhouse.csv", { cache: "force-cache" });
    if (!res.ok) {
      return snapshot;
    }
    const entry = tabularEntryFromIrisLabCsvText(await res.text());
    if (!entry) {
      return snapshot;
    }
    return { ...snapshot, tabularDatasets: [...snapshot.tabularDatasets, entry] };
  } catch {
    return snapshot;
  }
}

/** Мини-студия: если в облачном снимке нет таблиц — подставляем Iris из `public/Iris.csv` (как на сервере). */
export async function ensureIrisInMiniSnapshot(snapshot: NodlyProjectSnapshot): Promise<NodlyProjectSnapshot> {
  if (snapshot.tabularDatasets.length > 0) {
    return snapshot;
  }
  try {
    const res = await fetch("/Iris.csv", { cache: "force-cache" });
    if (!res.ok) {
      return snapshot;
    }
    const entry = tabularEntryFromIrisCsvText(await res.text());
    if (!entry) {
      return snapshot;
    }
    return { ...snapshot, tabularDatasets: [entry] };
  } catch {
    return snapshot;
  }
}
