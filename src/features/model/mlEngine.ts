import * as mobilenet from "@tensorflow-models/mobilenet";
import * as knnClassifier from "@tensorflow-models/knn-classifier";
import * as tf from "@tensorflow/tfjs";
import { RandomForestClassifier } from "ml-random-forest";
import MlSvm from "ml-svm";
import type {
  DatasetClass,
  ImageDataset,
  ModelEvaluation,
  ModelType,
  PredictionResult,
  SavedModelEntry,
  TabularDataset,
  TrainByModelTypeResult,
  TrainConfig,
  TrainingEpochLog,
  TrainingRunReport
} from "@/shared/types/ai";
import {
  deleteModelLibraryRecord,
  getModelLibraryRecord,
  putModelLibraryRecord,
  type TabularModelLibraryPayload
} from "@/features/model/modelLibraryMeta";
import { stripLeadingDuplicateHeaderRows } from "@/features/data/csv";
import { flatAggregateMetrics } from "@/shared/confusionMetrics";

let mobileNetModel: mobilenet.MobileNet | null = null;
const imageClassifier = knnClassifier.create();
let tabularModel: tf.LayersModel | null = null;
let tabularMode: "regression" | "classification" | null = null;
let tabularSvmModel: any | null = null;
let tabularRfModel: RandomForestClassifier | null = null;
let classIndexToLabel: string[] = [];
export type TabularCategoricalEncoding = "onehot" | "ordinal";

const OTHER_CATEGORY = "__OTHER__";

export type TabularFeatureSpec =
  | { kind: "numeric" }
  | {
      kind: "categorical";
      categories: string[];
      categoricalEncoding: TabularCategoricalEncoding;
      /** Частые значения; прочие кодируются как OTHER_CATEGORY (см. categories). */
      rareBucketTop?: string[];
    };
let tabularFeatureSpecs: TabularFeatureSpec[] = [];
let tabularNorm: { mean: number[]; std: number[] } | null = null;
/** Подписи для KNN по картинкам (в т.ч. кластеры cluster_0 … после обучения без учителя) */
let imageKnnExtraLabels: Record<string, string> = {};
/** Последняя успешно обученная модель (для сохранения в библиотеку). */
let lastTrainedModelType: ModelType | null = null;

const TABULAR_IDB_URL = (id: string) => `indexeddb://noda_tabular_${id}`;

function pickClusterCount(sampleCount: number): number {
  return Math.min(sampleCount, Math.min(8, Math.max(2, Math.round(Math.sqrt(sampleCount / 2)))));
}

function kMeansAssign(flat: Float32Array, n: number, dim: number, k: number): number[] {
  const centroids = new Float32Array(k * dim);
  for (let ci = 0; ci < k; ci++) {
    const idx = Math.min(n - 1, Math.floor(((ci + 0.5) * n) / k));
    for (let j = 0; j < dim; j++) {
      centroids[ci * dim + j] = flat[idx * dim + j];
    }
  }
  const assignments = new Array<number>(n);
  for (let iter = 0; iter < 40; iter++) {
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      const base = i * dim;
      for (let ci = 0; ci < k; ci++) {
        let d = 0;
        const cbase = ci * dim;
        for (let j = 0; j < dim; j++) {
          const diff = flat[base + j] - centroids[cbase + j];
          d += diff * diff;
        }
        if (d < bestD) {
          bestD = d;
          best = ci;
        }
      }
      assignments[i] = best;
    }
    const counts = new Array(k).fill(0);
    const newCent = new Float32Array(k * dim);
    for (let i = 0; i < n; i++) {
      const ci = assignments[i];
      counts[ci] += 1;
      const ib = i * dim;
      const cb = ci * dim;
      for (let j = 0; j < dim; j++) {
        newCent[cb + j] += flat[ib + j];
      }
    }
    for (let ci = 0; ci < k; ci++) {
      if (counts[ci] === 0) {
        continue;
      }
      for (let j = 0; j < dim; j++) {
        centroids[ci * dim + j] = newCent[ci * dim + j] / counts[ci];
      }
    }
  }
  return assignments;
}

async function getModel() {
  if (!mobileNetModel) {
    mobileNetModel = await mobilenet.load({ version: 2, alpha: 1 });
  }
  return mobileNetModel;
}

async function fileToImageBitmap(file: File) {
  return createImageBitmap(file);
}

export async function trainKnnModel(
  classes: DatasetClass[],
  onProgress: (progress: number, message: string) => void
) {
  imageClassifier.clearAllClasses();
  imageKnnExtraLabels = {};
  const model = await getModel();

  const totalSamples = classes.reduce((acc, item) => acc + item.files.length, 0);
  let processed = 0;

  for (const datasetClass of classes) {
    for (const file of datasetClass.files) {
      const bitmap = await fileToImageBitmap(file);
      const activation = tf.tidy(() => {
        const imageTensor = tf.browser.fromPixels(bitmap).toFloat();
        const resized = tf.image.resizeBilinear(imageTensor, [224, 224]);
        const normalized = resized.div(255);
        const batched = normalized.expandDims(0);
        return model.infer(batched, true) as tf.Tensor;
      });
      imageClassifier.addExample(activation, datasetClass.labelId);
      activation.dispose();
      bitmap.close();
      processed += 1;
      const progress = totalSamples > 0 ? Math.round((processed / totalSamples) * 100) : 100;
      onProgress(progress, `Обработано ${processed} из ${totalSamples} изображений`);
      await tf.nextFrame();
    }
  }
}

async function trainKnnClustering(
  files: File[],
  onProgress: (progress: number, message: string) => void
) {
  imageClassifier.clearAllClasses();
  imageKnnExtraLabels = {};
  const model = await getModel();
  const n = files.length;
  if (n < 2) {
    throw new Error("Для кластеризации нужно минимум 2 изображения.");
  }
  const k = pickClusterCount(n);
  const embeddings: tf.Tensor[] = [];
  let dim = 0;

  for (let i = 0; i < n; i++) {
    const bitmap = await fileToImageBitmap(files[i]);
    const activation = tf.tidy(() => {
      const imageTensor = tf.browser.fromPixels(bitmap).toFloat();
      const resized = tf.image.resizeBilinear(imageTensor, [224, 224]);
      const normalized = resized.div(255);
      const batched = normalized.expandDims(0);
      return model.infer(batched, true) as tf.Tensor;
    });
    if (dim === 0) {
      dim = activation.size;
    }
    embeddings.push(activation);
    bitmap.close();
    const progress = Math.round(((i + 1) / (n + 1)) * 90);
    onProgress(progress, `Признаки: ${i + 1} из ${n}`);
    await tf.nextFrame();
  }

  const flat = new Float32Array(n * dim);
  for (let i = 0; i < n; i++) {
    const data = await embeddings[i].data();
    flat.set(data, i * dim);
  }
  const assignments = kMeansAssign(flat, n, dim, k);
  onProgress(92, `K-means: ${k} групп`);

  for (let i = 0; i < n; i++) {
    imageClassifier.addExample(embeddings[i], `cluster_${assignments[i]}`);
    embeddings[i].dispose();
  }

  for (let c = 0; c < k; c++) {
    imageKnnExtraLabels[`cluster_${c}`] = `Кластер ${c + 1}`;
  }
  onProgress(100, `Готово: ${k} кластеров по сходству признаков MobileNet`);
}

async function predictImageByFile(
  file: File,
  labelsMap: Record<string, string>
): Promise<PredictionResult | null> {
  const classCount = Object.keys(imageClassifier.getClassExampleCount()).length;
  if (classCount === 0) {
    return null;
  }

  const model = await getModel();
  const bitmap = await fileToImageBitmap(file);
  const activation = tf.tidy(() => {
    const imageTensor = tf.browser.fromPixels(bitmap).toFloat();
    const resized = tf.image.resizeBilinear(imageTensor, [224, 224]);
    const normalized = resized.div(255);
    const batched = normalized.expandDims(0);
    return model.infer(batched, true) as tf.Tensor;
  });

  const result = await imageClassifier.predictClass(activation);
  activation.dispose();
  bitmap.close();

  const merged = { ...imageKnnExtraLabels, ...labelsMap };
  const title = merged[result.label] ?? result.label;
  return {
    labelId: result.label,
    title,
    confidence: result.confidences[result.label] ?? 0
  };
}

function padTabularRow(row: string[], len: number): string[] {
  const out = [...row];
  while (out.length < len) {
    out.push("");
  }
  return out.slice(0, len);
}

/** Число для регрессии: пробелы; одна запятая и 1–2 знака после — как десятичный разделитель (72,5). */
function parseRegressionTargetCell(raw: string): number {
  let t = raw.trim().replace(/\s/g, "");
  if (!t) {
    return NaN;
  }
  if (/^\d+,\d{1,2}$/.test(t)) {
    t = t.replace(",", ".");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function computeTrainValTestCounts(
  total: number,
  trainSplit: number,
  valSplit: number,
  _testSplit: number
): { trainCount: number; valCount: number; testCount: number } {
  let trainCount = Math.max(1, Math.floor(total * trainSplit));
  let valCount = Math.max(1, Math.floor(total * valSplit));
  let testCount = total - trainCount - valCount;
  if (testCount < 1) {
    testCount = 1;
  }
  while (trainCount + valCount + testCount > total) {
    if (trainCount >= valCount && trainCount >= testCount && trainCount > 1) {
      trainCount -= 1;
    } else if (valCount >= testCount && valCount > 1) {
      valCount -= 1;
    } else if (testCount > 1) {
      testCount -= 1;
    } else {
      break;
    }
  }
  return { trainCount, valCount, testCount };
}

/** Z-score по train; сохраняет параметры в tabularNorm для предсказания. */
function computeAndApplyTabularNorm(
  x: number[][],
  trainIdx: number[],
  featureCount: number
): { mean: number[]; std: number[] } {
  const mean: number[] = [];
  const std: number[] = [];
  if (trainIdx.length < 1 || featureCount < 1) {
    tabularNorm = null;
    return { mean: [], std: [] };
  }
  for (let j = 0; j < featureCount; j++) {
    let sum = 0;
    let sumSq = 0;
    const m = trainIdx.length;
    for (const i of trainIdx) {
      const v = x[i]![j] ?? 0;
      sum += v;
      sumSq += v * v;
    }
    const mu = sum / m;
    const variance = Math.max(sumSq / m - mu * mu, 1e-10);
    const s = Math.sqrt(variance);
    mean.push(mu);
    std.push(s);
  }
  for (let i = 0; i < x.length; i++) {
    const row = x[i];
    if (!row) {
      continue;
    }
    for (let j = 0; j < featureCount; j++) {
      row[j] = (row[j]! - mean[j]!) / std[j]!;
    }
  }
  tabularNorm = { mean, std };
  return { mean, std };
}

function applyTabularNormToVector(vec: number[]): number[] {
  if (!tabularNorm || tabularNorm.mean.length !== vec.length) {
    return vec;
  }
  const { mean, std } = tabularNorm;
  return vec.map((v, j) => (v - mean[j]!) / std[j]!);
}

/** Стратификация по классам, чтобы в train/val/test попали оба класса при дисбалансе. */
function stratifiedTrainValTestIndices(
  yIndices: number[],
  trainNeed: number,
  valNeed: number,
  testNeed: number
): { trainIdx: number[]; valIdx: number[]; testIdx: number[] } {
  const n = yIndices.length;
  const classIds = [...new Set(yIndices)].sort((a, b) => a - b);
  const queues = classIds.map((c) => {
    const q: number[] = [];
    for (let i = 0; i < n; i++) {
      if (yIndices[i] === c) {
        q.push(i);
      }
    }
    tf.util.shuffle(q);
    return q;
  });

  const takeRoundRobin = (target: number[], need: number) => {
    let k = 0;
    while (target.length < need) {
      let advanced = false;
      for (let t = 0; t < queues.length; t++) {
        const idx = (k + t) % queues.length;
        if (queues[idx].length > 0) {
          target.push(queues[idx].shift()!);
          advanced = true;
          k = (idx + 1) % queues.length;
          break;
        }
      }
      if (!advanced) {
        break;
      }
    }
  };

  const trainIdx: number[] = [];
  const valIdx: number[] = [];
  const testIdx: number[] = [];
  takeRoundRobin(trainIdx, trainNeed);
  takeRoundRobin(valIdx, valNeed);
  takeRoundRobin(testIdx, testNeed);
  for (const q of queues) {
    while (q.length > 0) {
      testIdx.push(q.shift()!);
    }
  }
  return { trainIdx, valIdx, testIdx };
}

function balancedClassSampleWeights1d(yIdx: number[], numClasses: number): Float32Array {
  const counts = new Array(numClasses).fill(0);
  for (const y of yIdx) {
    counts[y] += 1;
  }
  const n = yIdx.length;
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = yIdx[i]!;
    w[i] = n / (numClasses * Math.max(1, counts[c]!));
  }
  return w;
}

/** По умолчанию ordinal: компактные признаки для всех табличных моделей (деревья, SVM, TF). */
function parseTabular(
  dataset: TabularDataset,
  categoricalEncoding: TabularCategoricalEncoding = "ordinal"
) {
  const rowsAfterHeaderStrip = stripLeadingDuplicateHeaderRows(dataset.headers ?? [], dataset.rows);
  const rawRows = rowsAfterHeaderStrip.filter((row) => row.length >= 1);
  if (rawRows.length < 2) {
    throw new Error("Для табличных моделей нужно минимум 2 строки данных.");
  }
  const headerLen = dataset.headers?.length ?? 0;
  const maxRowLen = Math.max(...rawRows.map((r) => r.length), 1);
  const columnCount = Math.max(headerLen, maxRowLen, 1);
  const tiRaw = dataset.targetColumnIndex;
  let targetIndex = columnCount - 1;
  if (tiRaw !== undefined && tiRaw !== null) {
    const ti = Math.trunc(Number(tiRaw));
    if (Number.isFinite(ti) && ti >= 0 && ti < columnCount) {
      targetIndex = ti;
    }
  }
  const rows = rawRows.map((r) => padTabularRow(r, columnCount));
  const featureColumnIndices: number[] = [];
  for (let c = 0; c < columnCount; c++) {
    if (c !== targetIndex) {
      featureColumnIndices.push(c);
    }
  }
  if (featureColumnIndices.length === 0) {
    throw new Error("Нужна хотя бы одна колонка признаков.");
  }
  const rawX = rows.map((row) => featureColumnIndices.map((ci) => row[ci].trim()));
  const specs: TabularFeatureSpec[] = [];
  for (let col = 0; col < featureColumnIndices.length; col++) {
    const columnValues = rawX.map((row) => row[col]);
    const numericValues = columnValues.map((value) => Number(value));
    const allNumeric = numericValues.every((value) => !Number.isNaN(value));
    if (allNumeric) {
      specs.push({ kind: "numeric" });
    } else {
      const unique = [...new Set(columnValues)];
      const maxUnique = Math.min(80, Math.max(12, Math.floor(rawRows.length / 6)));
      let categories: string[];
      let rareBucketTop: string[] | undefined;
      if (unique.length > maxUnique && categoricalEncoding === "ordinal") {
        const freq = new Map<string, number>();
        for (const v of columnValues) {
          freq.set(v, (freq.get(v) ?? 0) + 1);
        }
        const top = [...freq.entries()]
          .sort(
            (a, b) =>
              b[1] - a[1] ||
              a[0].localeCompare(b[0], "en", {
                sensitivity: "base"
              })
          )
          .slice(0, maxUnique - 1)
          .map(([s]) => s);
        rareBucketTop = top;
        categories = [...top, OTHER_CATEGORY].sort((a, b) =>
          a.localeCompare(b, "en", { sensitivity: "base" })
        );
      } else {
        categories =
          categoricalEncoding === "ordinal"
            ? unique.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
            : unique;
      }
      specs.push({ kind: "categorical", categories, categoricalEncoding, rareBucketTop });
    }
  }
  const encode = (rawRow: string[]) => {
    const out: number[] = [];
    for (let col = 0; col < featureColumnIndices.length; col++) {
      const spec = specs[col];
      const value = rawRow[col];
      if (spec.kind === "numeric") {
        const num = Number(value);
        if (Number.isNaN(num)) {
          throw new Error("Числовой признак содержит нечисловое значение.");
        }
        out.push(num);
      } else if (spec.categoricalEncoding === "ordinal") {
        const cell =
          spec.rareBucketTop && !spec.rareBucketTop.includes(value) ? OTHER_CATEGORY : value;
        const j = spec.categories.indexOf(cell);
        out.push(j < 0 ? 0 : j);
      } else {
        for (const category of spec.categories) {
          out.push(value === category ? 1 : 0);
        }
      }
    }
    return out;
  };
  const x = rawX.map((row) => encode(row));
  tabularFeatureSpecs = specs;
  const yRaw = rows.map((row) => row[targetIndex].trim());
  const encodedFeatureDim = x[0]?.length ?? 0;
  return { x, yRaw, featureCount: encodedFeatureDim };
}

/** Метрики по фактическим y и предсказаниям на тесте (одномерная регрессия). */
function regressionMetricsFromVectors(
  yTrue: Float32Array | Int32Array | Uint8Array,
  yPred: Float32Array | Int32Array | Uint8Array,
  n: number
): {
  r2: number;
  medianAe: number;
  maxAe: number;
  smape: number;
} {
  if (n <= 0) {
    return { r2: 0, medianAe: 0, maxAe: 0, smape: 0 };
  }
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanY += yTrue[i];
  }
  meanY /= n;
  let sse = 0;
  let sst = 0;
  const absErrs: number[] = [];
  let smapeSum = 0;
  for (let i = 0; i < n; i++) {
    const yt = yTrue[i];
    const yp = yPred[i];
    const e = yt - yp;
    sse += e * e;
    sst += (yt - meanY) * (yt - meanY);
    absErrs.push(Math.abs(e));
    smapeSum += (2 * Math.abs(e)) / (Math.abs(yt) + Math.abs(yp) + 1e-8);
  }
  const r2 = sst > 1e-12 ? 1 - sse / sst : sse < 1e-12 ? 1 : 0;
  absErrs.sort((a, b) => a - b);
  const mid = Math.floor(absErrs.length / 2);
  const medianAe =
    absErrs.length % 2 === 1 ? absErrs[mid]! : ((absErrs[mid - 1] ?? 0) + (absErrs[mid] ?? 0)) / 2;
  const maxAe = absErrs[absErrs.length - 1] ?? 0;
  const smape = (100 / n) * smapeSum;
  return { r2, medianAe, maxAe, smape };
}

function logNumber(logs: tf.Logs | undefined, ...keys: string[]): number | undefined {
  if (!logs || typeof logs !== "object") {
    return undefined;
  }
  const raw = logs as Record<string, unknown>;
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
  }
  return undefined;
}

function buildClassificationArtifacts(args: {
  trueIdx: number[];
  predIdx: number[];
  confidences?: number[];
  labels: string[];
}) {
  const { trueIdx, predIdx, confidences, labels } = args;
  const n = Math.min(trueIdx.length, predIdx.length);
  const numClasses = labels.length;
  const confusion: number[][] = Array.from({ length: numClasses }, () =>
    Array.from({ length: numClasses }, () => 0)
  );
  const examples: { trueLabel: string; predictedLabel: string; confidence: number }[] = [];
  let correct = 0;
  for (let i = 0; i < n; i++) {
    const t = trueIdx[i];
    const p = predIdx[i];
    confusion[t][p] += 1;
    if (t === p) {
      correct += 1;
    }
    if (examples.length < 8) {
      examples.push({
        trueLabel: labels[t] ?? `class_${t}`,
        predictedLabel: labels[p] ?? `class_${p}`,
        confidence: confidences?.[i] ?? Number(t === p)
      });
    }
  }
  return {
    confusion,
    examples,
    accuracy: n > 0 ? correct / n : 0
  };
}

async function trainTabularModel(
  modelType: ModelType,
  dataset: TabularDataset,
  config: TrainConfig,
  onProgress: (progress: number, message: string) => void
): Promise<{ evaluation: ModelEvaluation; report: TrainingRunReport }> {
  const { x, yRaw, featureCount } = parseTabular(dataset);
  const total = x.length;
  if (total < 3) {
    throw new Error("Для train/val/test нужно минимум 3 строки в CSV.");
  }
  const { trainCount, valCount, testCount } = computeTrainValTestCounts(
    total,
    config.trainSplit,
    config.valSplit,
    config.testSplit
  );

  let trainIdx: number[];
  let valIdx: number[];
  let testIdx: number[];
  let uniqueLabels: string[] = [];
  const labelToIndexForSplit: Record<string, number> = {};
  let yIndicesForSplit: number[] = [];

  if (modelType === "tabular_regression") {
    const indices = x.map((_, index) => index);
    tf.util.shuffle(indices);
    trainIdx = indices.slice(0, trainCount);
    valIdx = indices.slice(trainCount, trainCount + valCount);
    testIdx = indices.slice(trainCount + valCount, trainCount + valCount + testCount);
  } else {
    uniqueLabels = [...new Set(yRaw)];
    for (let li = 0; li < uniqueLabels.length; li++) {
      labelToIndexForSplit[uniqueLabels[li]!] = li;
    }
    yIndicesForSplit = yRaw.map((value) => labelToIndexForSplit[value]!);
    ({ trainIdx, valIdx, testIdx } = stratifiedTrainValTestIndices(
      yIndicesForSplit,
      trainCount,
      valCount,
      testCount
    ));
  }

  computeAndApplyTabularNorm(x, trainIdx, featureCount);

  const xTrain = tf.tensor2d(trainIdx.map((i) => x[i]!));
  const xVal = tf.tensor2d(valIdx.map((i) => x[i]!));
  const xTest = tf.tensor2d(testIdx.map((i) => x[i]!));

  if (modelType === "tabular_regression") {
    const y = yRaw.map((value) => parseRegressionTargetCell(value));
    if (y.some((value) => Number.isNaN(value))) {
      const bad = yRaw.find((v) => Number.isNaN(parseRegressionTargetCell(v))) ?? "";
      throw new Error(
        `Для регрессии целевая колонка должна содержать числа. Первое нечисловое значение: «${bad.slice(0, 80)}». ` +
          `Частая причина — вторая строка файла повторяет заголовки; такие строки теперь отбрасываются при загрузке. ` +
          `Перезагрузи CSV или проверь разделитель (запятая / точка с запятой) и выбор целевой колонки в «Данные».`
      );
    }
    const yTrain = tf.tensor2d(trainIdx.map((i) => [y[i]]));
    const yVal = tf.tensor2d(valIdx.map((i) => [y[i]]));
    const yTest = tf.tensor2d(testIdx.map((i) => [y[i]]));
    tabularModel?.dispose();
    tabularModel = tf.sequential({
      layers: [tf.layers.dense({ inputShape: [featureCount], units: 1 })]
    });
    tabularModel.compile({
      optimizer: tf.train.adam(Math.min(config.learningRate, 0.005)),
      loss: "meanSquaredError",
      metrics: ["mse"]
    });
    const regEpochHistory: TrainingEpochLog[] = [];
    await tabularModel.fit(xTrain, yTrain, {
      epochs: config.epochs,
      validationData: [xVal, yVal],
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          regEpochHistory.push({
            epoch: epoch + 1,
            loss: logNumber(logs, "loss"),
            valLoss: logNumber(logs, "val_loss"),
            mse: logNumber(logs, "mse"),
            valMse: logNumber(logs, "val_mse", "val_mean_squared_error")
          });
          onProgress(
            Math.round(((epoch + 1) / config.epochs) * 100),
            `Эпоха ${epoch + 1} / ${config.epochs}`
          );
          await tf.nextFrame();
        }
      }
    });
    const testEval = tabularModel.evaluate(xTest, yTest) as tf.Tensor | tf.Tensor[];
    const evalTensors = Array.isArray(testEval) ? testEval : [testEval];
    const evalTensor = evalTensors[0];
    const mseValue = (await evalTensor.data())[0] ?? 0;
    for (const t of evalTensors) {
      t.dispose();
    }

    const preds = tabularModel.predict(xTest) as tf.Tensor;
    const maeTensor = tf.mean(tf.abs(tf.sub(preds, yTest)));
    const maeValue = (await maeTensor.data())[0] ?? 0;
    const predData = await preds.data();
    const yTestData = await yTest.data();
    const regressionExamples: { trueY: number; predictedY: number; absError: number }[] = [];
    const nTest = testIdx.length;
    for (let r = 0; r < Math.min(8, nTest); r++) {
      const trueY = yTestData[r];
      const predictedY = predData[r];
      regressionExamples.push({
        trueY,
        predictedY,
        absError: Math.abs(trueY - predictedY)
      });
    }
    preds.dispose();
    maeTensor.dispose();
    const rmseValue = Math.sqrt(mseValue);
    const extra = regressionMetricsFromVectors(yTestData, predData, nTest);

    tabularMode = "regression";
    classIndexToLabel = [];
    const summary =
      `Регрессия (тест): MSE ${mseValue.toFixed(4)}, MAE ${maeValue.toFixed(4)}, RMSE ${rmseValue.toFixed(4)}, ` +
      `R² ${extra.r2.toFixed(4)}, MedAE ${extra.medianAe.toFixed(4)}, Max|e| ${extra.maxAe.toFixed(4)}, sMAPE ${extra.smape.toFixed(2)}%`;
    const metrics = {
      testMSE: mseValue,
      testMAE: maeValue,
      testRMSE: rmseValue,
      testR2: extra.r2,
      testMedianAE: extra.medianAe,
      testMaxAbsError: extra.maxAe,
      testSMAPE: extra.smape
    };
    const report: TrainingRunReport = {
      kind: "tabular_regression",
      modelType: "tabular_regression",
      summary,
      metrics,
      epochHistory: regEpochHistory,
      regressionExamples
    };
    xTrain.dispose();
    xVal.dispose();
    xTest.dispose();
    yTrain.dispose();
    yVal.dispose();
    yTest.dispose();
    return { evaluation: { summary, metrics }, report };
  }

  const yIndices = yIndicesForSplit;
  if (uniqueLabels.length < 2) {
    throw new Error("Для классификации в целевой колонке нужно минимум 2 различных значения.");
  }
  const yTrainIdx = trainIdx.map((i) => yIndices[i]);
  const yValIdx = valIdx.map((i) => yIndices[i]);
  const yTestIdx = testIdx.map((i) => yIndices[i]);
  const yTrain = tf.oneHot(tf.tensor1d(yTrainIdx, "int32"), uniqueLabels.length);
  const yVal = tf.oneHot(tf.tensor1d(yValIdx, "int32"), uniqueLabels.length);
  const yTest = tf.oneHot(tf.tensor1d(yTestIdx, "int32"), uniqueLabels.length);

  let clsEpochHistory: TrainingEpochLog[] = [];
  let loss = 0;
  let acc = 0;
  let predictedIdx: number[] = [];
  let confidences: number[] = [];

  tabularSvmModel = null;
  tabularRfModel = null;
  tabularModel?.dispose();
  tabularModel = null;

  if (modelType === "tabular_svm") {
    if (uniqueLabels.length !== 2) {
      throw new Error("SVM в пилоте поддерживает бинарную классификацию (2 класса).");
    }
    const svm = new (MlSvm as any)({
      C: 1,
      tol: 1e-4,
      maxPasses: 30,
      maxIterations: 15000,
      kernel: "rbf",
      kernelOptions: { sigma: Math.max(0.1, 1 / Math.max(1, featureCount)) }
    });
    onProgress(15, "SVM: обучение...");
    const yTrainBinary = yTrainIdx.map((v) => (v === 0 ? -1 : 1));
    svm.train(trainIdx.map((i) => x[i]), yTrainBinary);
    const preds = svm.predict(testIdx.map((i) => x[i])) as number[];
    predictedIdx = preds.map((v) => (Number(v) >= 0 ? 1 : 0));
    confidences = predictedIdx.map(() => 1);
    acc =
      predictedIdx.length > 0
        ? predictedIdx.reduce((n, p, i) => n + Number(p === yTestIdx[i]), 0) / predictedIdx.length
        : 0;
    loss = 1 - acc;
    onProgress(100, "SVM: готово");
    tabularSvmModel = svm;
    tabularMode = "classification";
  } else if (modelType === "tabular_random_forest") {
    onProgress(15, "Random Forest: обучение...");
    const rf = new RandomForestClassifier({
      nEstimators: 100,
      maxFeatures: Math.max(
        2,
        Math.min(featureCount, Math.max(4, Math.round(featureCount ** 0.55)))
      ),
      replacement: true,
      seed: 42,
      // ml-cart по умолчанию gainThreshold=0.01: при слабом сигнале/разреженных one-hot
      // корень часто не режется вообще → лист = мода = всегда доминирующий класс.
      treeOptions: { gainThreshold: 0, minNumSamples: 2 }
    });
    rf.train(trainIdx.map((i) => x[i]), yTrainIdx);
    const preds = rf.predict(testIdx.map((i) => x[i]));
    predictedIdx = preds.map((v) => Math.max(0, Math.min(uniqueLabels.length - 1, Math.round(Number(v) || 0))));
    confidences = predictedIdx.map(() => 1);
    acc =
      predictedIdx.length > 0
        ? predictedIdx.reduce((n, p, i) => n + Number(p === yTestIdx[i]), 0) / predictedIdx.length
        : 0;
    loss = 1 - acc;
    onProgress(100, "Random Forest: готово");
    tabularRfModel = rf;
    tabularMode = "classification";
  } else {
    const buildTfClassifier = (kind: "linear" | "neural") => {
      if (kind === "neural") {
        return tf.sequential({
          layers: [
            tf.layers.dense({ inputShape: [featureCount], units: 16, activation: "relu" }),
            tf.layers.dense({ units: 8, activation: "relu" }),
            tf.layers.dense({ units: uniqueLabels.length, activation: "softmax" })
          ]
        });
      }
      return tf.sequential({
        layers: [
          tf.layers.dense({
            inputShape: [featureCount],
            units: uniqueLabels.length,
            activation: "softmax"
          })
        ]
      });
    };
    const runTfTrain = async (kind: "linear" | "neural") => {
      const swTrain = tf.tensor1d(balancedClassSampleWeights1d(yTrainIdx, uniqueLabels.length));
      const swVal = tf.tensor1d(balancedClassSampleWeights1d(yValIdx, uniqueLabels.length));
      const m = buildTfClassifier(kind);
      const epochs: TrainingEpochLog[] = [];
      const lr = Math.min(config.learningRate, 0.002);
      m.compile({
        optimizer: tf.train.adam(lr),
        loss: "categoricalCrossentropy",
        metrics: ["accuracy"]
      });
      await m.fit(xTrain, yTrain, {
        epochs: config.epochs,
        validationData: [xVal, yVal, swVal],
        sampleWeight: swTrain,
        callbacks: {
          onEpochEnd: async (epoch, logs) => {
            epochs.push({
              epoch: epoch + 1,
              loss: logNumber(logs, "loss"),
              valLoss: logNumber(logs, "val_loss"),
              accuracy: logNumber(logs, "accuracy"),
              valAccuracy: logNumber(logs, "val_accuracy", "val_acc")
            });
            onProgress(
              Math.round(((epoch + 1) / config.epochs) * 100),
              `Эпоха ${epoch + 1} / ${config.epochs}`
            );
            await tf.nextFrame();
          }
        }
      });
      swTrain.dispose();
      swVal.dispose();
      const evalTensors = m.evaluate(xTest, yTest) as tf.Tensor[];
      const modelLoss = (await evalTensors[0].data())[0] ?? 0;
      const modelAcc = (await evalTensors[1].data())[0] ?? 0;
      for (const t of evalTensors) {
        t.dispose();
      }
      const predTensor = m.predict(xTest) as tf.Tensor;
      const predArr = await predTensor.data();
      predTensor.dispose();
      const predIdx: number[] = [];
      const conf: number[] = [];
      for (let r = 0; r < testIdx.length; r++) {
        let pIdx = 0;
        let maxProb = -1;
        for (let c = 0; c < uniqueLabels.length; c++) {
          const p = predArr[r * uniqueLabels.length + c];
          if (p > maxProb) {
            maxProb = p;
            pIdx = c;
          }
        }
        predIdx.push(pIdx);
        conf.push(maxProb);
      }
      return { model: m, epochs, modelLoss, modelAcc, predIdx, conf };
    };
    if (modelType === "tabular_orchestrator") {
      onProgress(5, "Оркестр: логистическая модель");
      const linear = await runTfTrain("linear");
      const linearScore = linear.modelAcc;
      onProgress(52, "Оркестр: нейросеть MLP");
      const neural = await runTfTrain("neural");
      const neuralScore = neural.modelAcc;
      const best = neuralScore >= linearScore ? neural : linear;
      if (best !== linear) {
        linear.model.dispose();
      }
      if (best !== neural) {
        neural.model.dispose();
      }
      tabularModel = best.model;
      clsEpochHistory = best.epochs;
      loss = best.modelLoss;
      acc = best.modelAcc;
      predictedIdx = best.predIdx;
      confidences = best.conf;
    } else {
      const kind = modelType === "tabular_neural" ? "neural" : "linear";
      const single = await runTfTrain(kind);
      tabularModel = single.model;
      clsEpochHistory = single.epochs;
      loss = single.modelLoss;
      acc = single.modelAcc;
      predictedIdx = single.predIdx;
      confidences = single.conf;
    }
    tabularMode = "classification";
  }

  const artifacts = buildClassificationArtifacts({
    trueIdx: yTestIdx,
    predIdx: predictedIdx,
    confidences,
    labels: uniqueLabels
  });
  tabularMode = "classification";
  classIndexToLabel = uniqueLabels;
  xTrain.dispose();
  xVal.dispose();
  xTest.dispose();
  yTrain.dispose();
  yVal.dispose();
  yTest.dispose();

  const summary = `Classification test accuracy: ${(acc * 100).toFixed(1)}%`;
  const cmData = { labels: [...uniqueLabels], matrix: artifacts.confusion };
  const metrics = { testLoss: loss, testAccuracy: acc, ...flatAggregateMetrics(cmData) };
  const report: TrainingRunReport = {
    kind: "tabular_classification",
    modelType,
    summary,
    metrics,
    epochHistory: clsEpochHistory,
    confusionMatrix: cmData,
    classificationExamples: artifacts.examples
  };
  return { evaluation: { summary, metrics }, report };
}

export async function trainByModelType(args: {
  modelType: ModelType;
  imageDataset: ImageDataset | null;
  tabularDataset: TabularDataset | null;
  config: TrainConfig;
  onProgress: (progress: number, message: string) => void;
}): Promise<TrainByModelTypeResult> {
  if (args.modelType === "image_knn") {
    const ds = args.imageDataset;
    if (!ds) {
      throw new Error("Для image модели выбери набор изображений в блоке обучения.");
    }
    if (ds.taskType === "clustering") {
      let pool = ds.unlabeledFiles ?? [];
      if (pool.length < 2) {
        const legacy = ds.classes.flatMap((c) => c.files);
        if (legacy.length >= 2) {
          pool = legacy;
        }
      }
      if (pool.length < 2) {
        throw new Error("В наборе для кластеризации нужно минимум 2 изображения.");
      }
      await trainKnnClustering(pool, args.onProgress);
      lastTrainedModelType = "image_knn";
      const summary = `Кластеризация: ${pool.length} изображений, группы по сходству (K-means + KNN)`;
      const metrics = { samples: pool.length };
      return {
        evaluation: { summary, metrics },
        report: {
          kind: "image_clustering",
          modelType: "image_knn",
          summary,
          metrics,
          epochHistory: []
        }
      };
    }
    const hasSamples = ds.classes.some((c) => c.files.length > 0);
    if (!hasSamples) {
      throw new Error("Добавь фото в классы набора для классификации.");
    }
    await trainKnnModel(ds.classes, args.onProgress);
    const sampleCount = ds.classes.reduce((sum, item) => sum + item.files.length, 0);
    lastTrainedModelType = "image_knn";
    const summary = `Image KNN обучен на ${sampleCount} изображениях`;
    const metrics = { samples: sampleCount };
    return {
      evaluation: { summary, metrics },
      report: {
        kind: "image_knn",
        modelType: "image_knn",
        summary,
        metrics,
        epochHistory: []
      }
    };
  }
  if (!args.tabularDataset) {
    throw new Error("Для табличной модели сначала загрузи CSV в библиотеке.");
  }
  const tabularEval = await trainTabularModel(
    args.modelType,
    args.tabularDataset,
    args.config,
    args.onProgress
  );
  lastTrainedModelType = args.modelType;
  return tabularEval;
}

export function getLastTrainedModelType(): ModelType | null {
  return lastTrainedModelType;
}

export function canPersistCurrentModel(): boolean {
  if (tabularModel && tabularMode && lastTrainedModelType && lastTrainedModelType !== "image_knn") {
    return true;
  }
  if (lastTrainedModelType === "image_knn" && imageClassifier.getNumClasses() > 0) {
    return true;
  }
  return false;
}

function disposeTabularInMemory() {
  tabularModel?.dispose();
  tabularModel = null;
  tabularMode = null;
  tabularSvmModel = null;
  tabularRfModel = null;
  classIndexToLabel = [];
  tabularFeatureSpecs = [];
  tabularNorm = null;
}

function clearKnnInMemory() {
  imageClassifier.clearAllClasses();
  imageKnnExtraLabels = {};
}

/** Сохраняет текущую модель в IndexedDB + метаданные (таблица: tf.io; KNN: один JSON в meta-БД). */
export async function persistCurrentModelToLibrary(modelId: string): Promise<{ modelType: ModelType }> {
  if (tabularModel && tabularMode && lastTrainedModelType && lastTrainedModelType !== "image_knn") {
    await tabularModel.save(TABULAR_IDB_URL(modelId));
    const payload: TabularModelLibraryPayload = {
      kind: "tabular",
      modelType: lastTrainedModelType,
      tabularMode,
      classIndexToLabel: [...classIndexToLabel],
      tabularFeatureSpecs: tabularFeatureSpecs.map((s) =>
        s.kind === "numeric"
          ? { kind: "numeric" }
          : {
              kind: "categorical",
              categories: [...s.categories],
              categoricalEncoding: s.categoricalEncoding,
              ...(s.rareBucketTop ? { rareBucketTop: [...s.rareBucketTop] } : {})
            }
      ),
      ...(tabularNorm ? { tabularNorm: { mean: [...tabularNorm.mean], std: [...tabularNorm.std] } } : {})
    };
    await putModelLibraryRecord({ id: modelId, ...payload });
    return { modelType: lastTrainedModelType };
  }
  if (lastTrainedModelType === "image_knn" && imageClassifier.getNumClasses() > 0) {
    const ds = imageClassifier.getClassifierDataset();
    const dataset: Record<string, { shape: number[]; data: number[] }> = {};
    for (const [label, tensor] of Object.entries(ds)) {
      const t = tensor as tf.Tensor2D;
      dataset[label] = { shape: t.shape.slice(), data: Array.from(t.dataSync()) };
    }
    await putModelLibraryRecord({
      id: modelId,
      kind: "knn",
      extraLabels: { ...imageKnnExtraLabels },
      dataset
    });
    return { modelType: "image_knn" };
  }
  throw new Error("Нет обученной модели: сначала выполни блок «Обучить модель».");
}

export async function loadModelFromLibraryEntry(entry: SavedModelEntry): Promise<void> {
  const rec = await getModelLibraryRecord(entry.id);
  if (!rec) {
    throw new Error("Файлы модели не найдены в браузере (очищен IndexedDB или другой браузер).");
  }
  if (rec.kind === "tabular") {
    clearKnnInMemory();
    disposeTabularInMemory();
    tabularModel = await tf.loadLayersModel(TABULAR_IDB_URL(entry.id));
    tabularMode = rec.tabularMode;
    classIndexToLabel = [...rec.classIndexToLabel];
    tabularFeatureSpecs = rec.tabularFeatureSpecs.map((s) =>
      s.kind === "numeric"
        ? { kind: "numeric" }
        : {
            kind: "categorical",
            categories: [...s.categories],
            categoricalEncoding: s.categoricalEncoding ?? "ordinal",
            ...(s.rareBucketTop ? { rareBucketTop: [...s.rareBucketTop] } : {})
          }
    );
    tabularNorm =
      rec.tabularNorm && rec.tabularNorm.mean.length > 0
        ? { mean: [...rec.tabularNorm.mean], std: [...rec.tabularNorm.std] }
        : null;
    lastTrainedModelType = entry.modelType;
    return;
  }
  disposeTabularInMemory();
  imageClassifier.clearAllClasses();
  imageKnnExtraLabels = { ...rec.extraLabels };
  const tensors: Record<string, tf.Tensor2D> = {};
  for (const [label, payload] of Object.entries(rec.dataset)) {
    const [rows, cols] = payload.shape;
    tensors[label] = tf.tensor2d(payload.data, [rows, cols]);
  }
  imageClassifier.setClassifierDataset(tensors);
  lastTrainedModelType = "image_knn";
}

export async function removeStoredModelFiles(entry: SavedModelEntry): Promise<void> {
  await deleteModelLibraryRecord(entry.id);
  if (entry.modelType === "image_knn") {
    return;
  }
  try {
    await tf.io.removeModel(TABULAR_IDB_URL(entry.id));
  } catch {
    /* ignore */
  }
}

function parsePredictionFeatures(input: string) {
  const raw = input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (tabularFeatureSpecs.length === 0) {
    const numeric = raw.map((item) => Number(item)).filter((item) => !Number.isNaN(item));
    if (numeric.length === 0) {
      throw new Error("Введите признаки для предсказания, например: 1.2, 3.4, 5");
    }
    return numeric;
  }
  if (raw.length !== tabularFeatureSpecs.length) {
    throw new Error(
      `Нужно ${tabularFeatureSpecs.length} признаков через запятую. Сейчас: ${raw.length}.`
    );
  }
  const out: number[] = [];
  for (let i = 0; i < tabularFeatureSpecs.length; i++) {
    const spec = tabularFeatureSpecs[i];
    const value = raw[i];
    if (spec.kind === "numeric") {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new Error(`Признак #${i + 1} должен быть числом.`);
      }
      out.push(num);
    } else if (spec.categoricalEncoding === "ordinal") {
      const cell =
        spec.rareBucketTop && !spec.rareBucketTop.includes(value) ? OTHER_CATEGORY : value;
      const j = spec.categories.indexOf(cell);
      out.push(j < 0 ? 0 : j);
    } else {
      for (const category of spec.categories) {
        out.push(value === category ? 1 : 0);
      }
    }
  }
  return out;
}

async function predictTabularByInput(input: string): Promise<PredictionResult | null> {
  if (!tabularMode || (!tabularModel && !tabularSvmModel && !tabularRfModel)) {
    return null;
  }
  const features = applyTabularNormToVector(parsePredictionFeatures(input));
  if (tabularSvmModel && tabularMode === "classification") {
    const pred = tabularSvmModel.predictOne(features);
    const idx = Math.max(0, Math.min(classIndexToLabel.length - 1, Math.round(Number(pred) || 0)));
    const title = classIndexToLabel[idx] ?? `class_${idx}`;
    return {
      labelId: title,
      title,
      confidence: 1
    };
  }
  if (tabularRfModel && tabularMode === "classification") {
    const pred = tabularRfModel.predict([features])[0] ?? 0;
    const idx = Math.max(0, Math.min(classIndexToLabel.length - 1, Math.round(Number(pred) || 0)));
    const title = classIndexToLabel[idx] ?? `class_${idx}`;
    return {
      labelId: title,
      title,
      confidence: 1
    };
  }
  if (!tabularModel) {
    return null;
  }
  const x = tf.tensor2d([features]);
  const y = tabularModel.predict(x) as tf.Tensor;
  const values = Array.from(await y.data());
  x.dispose();
  y.dispose();

  if (tabularMode === "regression") {
    const value = values[0] ?? 0;
    return {
      labelId: "regression_output",
      title: `Прогноз: ${value.toFixed(4)}`,
      confidence: 1
    };
  }

  let maxIndex = 0;
  let maxValue = values[0] ?? 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > maxValue) {
      maxValue = values[i];
      maxIndex = i;
    }
  }
  const title = classIndexToLabel[maxIndex] ?? `class_${maxIndex}`;
  return {
    labelId: title,
    title,
    confidence: maxValue
  };
}

export async function predictByModelType(args: {
  modelType: ModelType;
  predictionFile: File | null;
  labelsMap: Record<string, string>;
  tabularInput: string;
}) {
  if (args.modelType === "image_knn") {
    if (!args.predictionFile) {
      throw new Error("Для image модели нужно выбрать изображение для предсказания.");
    }
    return predictImageByFile(args.predictionFile, args.labelsMap);
  }
  return predictTabularByInput(args.tabularInput);
}
