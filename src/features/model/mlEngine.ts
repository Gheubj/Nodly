import * as mobilenet from "@tensorflow-models/mobilenet";
import * as knnClassifier from "@tensorflow-models/knn-classifier";
import * as tf from "@tensorflow/tfjs";
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
import { flatAggregateMetrics } from "@/shared/confusionMetrics";

let mobileNetModel: mobilenet.MobileNet | null = null;
const imageClassifier = knnClassifier.create();
let tabularModel: tf.LayersModel | null = null;
let tabularMode: "regression" | "classification" | null = null;
let classIndexToLabel: string[] = [];
export type TabularFeatureSpec =
  | { kind: "numeric" }
  | { kind: "categorical"; categories: string[] };
let tabularFeatureSpecs: TabularFeatureSpec[] = [];
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

function parseTabular(dataset: TabularDataset) {
  const rows = dataset.rows.filter((row) => row.length >= 2);
  if (rows.length < 2) {
    throw new Error("Для табличных моделей нужно минимум 2 строки данных.");
  }
  const featureCount = rows[0].length - 1;
  const rawX = rows.map((row) => row.slice(0, featureCount).map((value) => value.trim()));
  const specs: TabularFeatureSpec[] = [];
  for (let col = 0; col < featureCount; col++) {
    const columnValues = rawX.map((row) => row[col]);
    const numericValues = columnValues.map((value) => Number(value));
    const allNumeric = numericValues.every((value) => !Number.isNaN(value));
    if (allNumeric) {
      specs.push({ kind: "numeric" });
    } else {
      const categories = [...new Set(columnValues)];
      specs.push({ kind: "categorical", categories });
    }
  }
  const encode = (rawRow: string[]) => {
    const out: number[] = [];
    for (let col = 0; col < featureCount; col++) {
      const spec = specs[col];
      const value = rawRow[col];
      if (spec.kind === "numeric") {
        const num = Number(value);
        if (Number.isNaN(num)) {
          throw new Error("Числовой признак содержит нечисловое значение.");
        }
        out.push(num);
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
  const yRaw = rows.map((row) => row[featureCount].trim());
  return { x, yRaw, featureCount: x[0]?.length ?? featureCount };
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

async function trainTabularModel(
  modelType: ModelType,
  dataset: TabularDataset,
  config: TrainConfig,
  onProgress: (progress: number, message: string) => void
): Promise<{ evaluation: ModelEvaluation; report: TrainingRunReport }> {
  const { x, yRaw, featureCount } = parseTabular(dataset);
  const indices = x.map((_, index) => index);
  tf.util.shuffle(indices);
  const total = indices.length;
  if (total < 3) {
    throw new Error("Для train/val/test нужно минимум 3 строки в CSV.");
  }
  let trainCount = Math.max(1, Math.floor(total * config.trainSplit));
  let valCount = Math.max(1, Math.floor(total * config.valSplit));
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
  const trainIdx = indices.slice(0, trainCount);
  const valIdx = indices.slice(trainCount, trainCount + valCount);
  const testIdx = indices.slice(trainCount + valCount, trainCount + valCount + testCount);
  const xTrain = tf.tensor2d(trainIdx.map((i) => x[i]));
  const xVal = tf.tensor2d(valIdx.map((i) => x[i]));
  const xTest = tf.tensor2d(testIdx.map((i) => x[i]));

  if (modelType === "tabular_regression") {
    const y = yRaw.map((value) => Number(value));
    if (y.some((value) => Number.isNaN(value))) {
      throw new Error("Для регрессии целевая колонка должна быть числом.");
    }
    const yTrain = tf.tensor2d(trainIdx.map((i) => [y[i]]));
    const yVal = tf.tensor2d(valIdx.map((i) => [y[i]]));
    const yTest = tf.tensor2d(testIdx.map((i) => [y[i]]));
    tabularModel?.dispose();
    tabularModel = tf.sequential({
      layers: [tf.layers.dense({ inputShape: [featureCount], units: 1 })]
    });
    tabularModel.compile({
      optimizer: tf.train.adam(config.learningRate),
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
            `Эпоха ${epoch + 1}/${config.epochs}`
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

    tabularMode = "regression";
    classIndexToLabel = [];
    const summary = `Регрессия (тест): MSE ${mseValue.toFixed(4)}, MAE ${maeValue.toFixed(4)}, RMSE ${rmseValue.toFixed(4)}`;
    const metrics = { testMSE: mseValue, testMAE: maeValue, testRMSE: rmseValue };
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

  const uniqueLabels = [...new Set(yRaw)];
  const labelToIndex = uniqueLabels.reduce<Record<string, number>>((acc, value, index) => {
    acc[value] = index;
    return acc;
  }, {});
  const yIndices = yRaw.map((value) => labelToIndex[value]);
  const buildOneHot = (rows: number[]) =>
    tf.oneHot(tf.tensor1d(rows.map((i) => yIndices[i]), "int32"), uniqueLabels.length);
  const yTrain = buildOneHot(trainIdx);
  const yVal = buildOneHot(valIdx);
  const yTest = buildOneHot(testIdx);

  tabularModel?.dispose();
  if (modelType === "tabular_neural") {
    tabularModel = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [featureCount], units: 16, activation: "relu" }),
        tf.layers.dense({ units: 8, activation: "relu" }),
        tf.layers.dense({ units: uniqueLabels.length, activation: "softmax" })
      ]
    });
  } else {
    tabularModel = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [featureCount],
          units: uniqueLabels.length,
          activation: "softmax"
        })
      ]
    });
  }
  tabularModel.compile({
    optimizer: tf.train.adam(config.learningRate),
    loss: "categoricalCrossentropy",
    metrics: ["accuracy"]
  });
  const clsEpochHistory: TrainingEpochLog[] = [];
  await tabularModel.fit(xTrain, yTrain, {
    epochs: config.epochs,
    validationData: [xVal, yVal],
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        clsEpochHistory.push({
          epoch: epoch + 1,
          loss: logNumber(logs, "loss"),
          valLoss: logNumber(logs, "val_loss"),
          accuracy: logNumber(logs, "accuracy"),
          valAccuracy: logNumber(logs, "val_accuracy", "val_acc")
        });
        onProgress(
          Math.round(((epoch + 1) / config.epochs) * 100),
          `Эпоха ${epoch + 1}/${config.epochs}`
        );
        await tf.nextFrame();
      }
    }
  });
  const evaluationTensors = tabularModel.evaluate(xTest, yTest) as tf.Tensor[];
  const loss = (await evaluationTensors[0].data())[0] ?? 0;
  const acc = (await evaluationTensors[1].data())[0] ?? 0;
  for (const t of evaluationTensors) {
    t.dispose();
  }

  const numClasses = uniqueLabels.length;
  const confusion: number[][] = Array.from({ length: numClasses }, () =>
    Array.from({ length: numClasses }, () => 0)
  );
  const predTensor = tabularModel.predict(xTest) as tf.Tensor;
  const predArr = await predTensor.data();
  const yTestFlat = await yTest.data();
  const nTestRows = testIdx.length;
  const classificationExamples: {
    trueLabel: string;
    predictedLabel: string;
    confidence: number;
  }[] = [];

  for (let r = 0; r < nTestRows; r++) {
    let predIdx = 0;
    let maxProb = -1;
    for (let c = 0; c < numClasses; c++) {
      const p = predArr[r * numClasses + c];
      if (p > maxProb) {
        maxProb = p;
        predIdx = c;
      }
    }
    let trueIdx = 0;
    for (let c = 0; c < numClasses; c++) {
      if (yTestFlat[r * numClasses + c] > 0.5) {
        trueIdx = c;
        break;
      }
    }
    confusion[trueIdx][predIdx] += 1;
    if (classificationExamples.length < 8) {
      const rowIndex = testIdx[r];
      classificationExamples.push({
        trueLabel: uniqueLabels[yIndices[rowIndex]],
        predictedLabel: uniqueLabels[predIdx],
        confidence: maxProb
      });
    }
  }

  predTensor.dispose();
  tabularMode = "classification";
  classIndexToLabel = uniqueLabels;
  xTrain.dispose();
  xVal.dispose();
  xTest.dispose();
  yTrain.dispose();
  yVal.dispose();
  yTest.dispose();

  const summary = `Classification test accuracy: ${(acc * 100).toFixed(1)}%`;
  const cmData = { labels: [...uniqueLabels], matrix: confusion };
  const metrics = { testLoss: loss, testAccuracy: acc, ...flatAggregateMetrics(cmData) };
  const report: TrainingRunReport = {
    kind: "tabular_classification",
    modelType,
    summary,
    metrics,
    epochHistory: clsEpochHistory,
    confusionMatrix: cmData,
    classificationExamples
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
  classIndexToLabel = [];
  tabularFeatureSpecs = [];
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
        s.kind === "numeric" ? { kind: "numeric" } : { kind: "categorical", categories: [...s.categories] }
      )
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
      s.kind === "numeric" ? { kind: "numeric" } : { kind: "categorical", categories: [...s.categories] }
    );
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
    } else {
      for (const category of spec.categories) {
        out.push(value === category ? 1 : 0);
      }
    }
  }
  return out;
}

async function predictTabularByInput(input: string): Promise<PredictionResult | null> {
  if (!tabularModel || !tabularMode) {
    return null;
  }
  const features = parsePredictionFeatures(input);
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
