import type { TabularDataset, TabularDatasetEntry } from "@/shared/types/ai";

/** Ниже порога храним строки как JSON-массив (как раньше). */
const TABULAR_GZIP_ROW_THRESHOLD = 5000;

function uint8ToBase64(u8: Uint8Array): string {
  const chunks: string[] = [];
  const size = 0x8000;
  for (let i = 0; i < u8.length; i += size) {
    chunks.push(String.fromCharCode(...u8.subarray(i, i + size)));
  }
  return btoa(chunks.join(""));
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function tabularDatasetNeedsMaterialize(ds: TabularDataset): boolean {
  return Boolean(ds.rowsGzipBase64) && ds.rows.length === 0;
}

export async function materializeTabularDataset(ds: TabularDataset): Promise<TabularDataset> {
  if (!tabularDatasetNeedsMaterialize(ds) || !ds.rowsGzipBase64) {
    return ds;
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Браузер не поддерживает распаковку таблицы (DecompressionStream).");
  }
  const bin = base64ToUint8(ds.rowsGzipBase64);
  const stream = new Blob([new Uint8Array(bin)]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  const parsed = JSON.parse(text) as {
    headers: string[];
    rows: string[][];
    targetColumnIndex?: number;
  };
  return {
    headers: parsed.headers,
    rows: parsed.rows,
    targetColumnIndex: parsed.targetColumnIndex ?? ds.targetColumnIndex,
    tabularStoredRowCount: undefined,
    rowsGzipBase64: undefined
  };
}

export async function materializeTabularDatasetEntries(entries: TabularDatasetEntry[]): Promise<TabularDatasetEntry[]> {
  return Promise.all(
    entries.map(async (e) => ({
      ...e,
      dataset: await materializeTabularDataset(e.dataset)
    }))
  );
}

async function compactTabularDataset(ds: TabularDataset): Promise<TabularDataset> {
  if (ds.rowsGzipBase64 || ds.rows.length < TABULAR_GZIP_ROW_THRESHOLD) {
    return ds;
  }
  if (typeof CompressionStream === "undefined") {
    return ds;
  }
  const payload = JSON.stringify({
    headers: ds.headers,
    rows: ds.rows,
    targetColumnIndex: ds.targetColumnIndex
  });
  const buf = await new Response(
    new Blob([payload]).stream().pipeThrough(new CompressionStream("gzip"))
  ).arrayBuffer();
  const rowsGzipBase64 = uint8ToBase64(new Uint8Array(buf));
  return {
    headers: ds.headers,
    rows: [],
    targetColumnIndex: ds.targetColumnIndex,
    tabularStoredRowCount: ds.rows.length,
    rowsGzipBase64
  };
}

export async function compactTabularDatasetEntries(entries: TabularDatasetEntry[]): Promise<TabularDatasetEntry[]> {
  return Promise.all(
    entries.map(async (e) => ({
      ...e,
      dataset: await compactTabularDataset(e.dataset)
    }))
  );
}
