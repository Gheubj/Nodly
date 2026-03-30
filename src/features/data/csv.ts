import type { TabularDataset } from "@/shared/types/ai";

export async function parseCsvFile(file: File): Promise<TabularDataset> {
  if (file.size > 50 * 1024 * 1024) {
    throw new Error("CSV файл слишком большой (макс 50MB).");
  }
  const text = await file.text();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV должен содержать заголовок и минимум одну строку данных.");
  }
  if (lines.length > 10000) {
    throw new Error("Слишком много строк (макс 10,000).");
  }

  const headers = lines[0].split(",").map((part) => part.trim());
  const rows = lines.slice(1).map((line) => line.split(",").map((part) => part.trim()));

  return { headers, rows };
}
