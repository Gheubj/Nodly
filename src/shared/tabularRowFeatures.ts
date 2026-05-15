import type { TabularDataset } from "@/shared/types/ai";

/**
 * Строка признаков через запятую для предсказания: все колонки, кроме целевой.
 * Порядок колонок как в датасете (как при обучении).
 */
export function featureStringFromDatasetRow(dataset: TabularDataset, rowIndex: number): string | null {
  const row = dataset.rows[rowIndex];
  if (!row || row.length === 0) {
    return null;
  }
  const tci = dataset.targetColumnIndex ?? Math.max(0, row.length - 1);
  const parts: string[] = [];
  for (let i = 0; i < row.length; i += 1) {
    if (i === tci) {
      continue;
    }
    parts.push(String(row[i]).trim());
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join(",");
}
