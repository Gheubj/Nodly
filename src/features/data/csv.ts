import type { TabularDataset } from "@/shared/types/ai";

/** Удаляет из начала данных строки, совпадающие со строкой заголовков (частый дубликат заголовка в CSV). */
export function stripLeadingDuplicateHeaderRows(headers: string[], rows: string[][]): string[][] {
  if (!headers.length || !rows.length) {
    return rows;
  }
  const hdr = headers.map((h) => h.trim().toLowerCase());
  let rest = rows;
  while (rest.length > 0) {
    const row = rest[0];
    if (row.length < hdr.length) {
      break;
    }
    const same = hdr.every((h, i) => (row[i] ?? "").trim().toLowerCase() === h);
    if (!same) {
      break;
    }
    rest = rest.slice(1);
  }
  return rest;
}

/** Разбор строки с учётом кавычек/экранирования. */
function splitDelimitedLine(line: string, delimiter: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === delimiter) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur.trim());
  return parts;
}

/** Полноценный парсинг всего CSV, включая переносы строк внутри кавычек. */
function parseDelimitedText(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && c === delimiter) {
      row.push(cur.trim());
      cur = "";
      continue;
    }
    if (!inQuotes && (c === "\n" || c === "\r")) {
      row.push(cur.trim());
      cur = "";
      if (!(row.length === 1 && row[0] === "")) {
        rows.push(row);
      }
      row = [];
      if (c === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      continue;
    }
    cur += c;
  }
  row.push(cur.trim());
  if (!(row.length === 1 && row[0] === "")) {
    rows.push(row);
  }
  return rows;
}

/** Выбираем один разделитель на весь файл, чтобы колонки не "плавали" между строками. */
function pickCsvDelimiter(lines: string[]): "\t" | ";" | "," {
  const delims = ["\t", ";", ","] as const;
  const sample = lines.slice(0, Math.min(lines.length, 300));
  let bestDelim: "\t" | ";" | "," = ",";
  let bestScore = -1;
  let bestHeaderCols = 1;
  for (const d of delims) {
    const counts = sample.map((line) => splitDelimitedLine(line, d).length);
    const headerCols = counts[0] ?? 1;
    const consistent = counts.reduce((n, c) => n + Number(c === headerCols), 0);
    // Приоритет: согласованность с заголовком, затем число колонок.
    const score = consistent * 1000 + headerCols;
    if (score > bestScore || (score === bestScore && headerCols > bestHeaderCols)) {
      bestScore = score;
      bestHeaderCols = headerCols;
      bestDelim = d;
    }
  }
  return bestDelim;
}

export async function parseCsvFile(file: File): Promise<TabularDataset> {
  if (file.size > 50 * 1024 * 1024) {
    throw new Error("CSV файл слишком большой (макс 50MB).");
  }
  let text = await file.text();
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const previewLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (previewLines.length < 2) {
    throw new Error("CSV должен содержать заголовок и минимум одну строку данных.");
  }
  const delimiter = pickCsvDelimiter(previewLines);
  const parsedRows = parseDelimitedText(text, delimiter);
  if (parsedRows.length < 2) {
    throw new Error("CSV должен содержать заголовок и минимум одну строку данных.");
  }
  if (parsedRows.length > 50001) {
    throw new Error("Слишком много строк (макс 50,000).");
  }
  const headers = parsedRows[0]!;
  const rowsRaw = parsedRows.slice(1);
  const rows = stripLeadingDuplicateHeaderRows(headers, rowsRaw);
  if (rows.length < 1) {
    throw new Error("После заголовка не осталось строк данных (возможно, все строки совпадали с заголовком).");
  }
  const targetColumnIndex = Math.max(0, headers.length - 1);

  return { headers, rows, targetColumnIndex };
}
