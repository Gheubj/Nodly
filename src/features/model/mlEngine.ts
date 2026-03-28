import * as mobilenet from "@tensorflow-models/mobilenet";
import * as knnClassifier from "@tensorflow-models/knn-classifier";
import * as tf from "@tensorflow/tfjs";
import type {
  DatasetClass,
  ModelType,
  PredictionResult,
  TabularDataset
} from "@/shared/types/ai";

let mobileNetModel: mobilenet.MobileNet | null = null;
const imageClassifier = knnClassifier.create();
let tabularModel: tf.LayersModel | null = null;
let tabularMode: "regression" | "classification" | null = null;
let classIndexToLabel: string[] = [];

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

  const title = labelsMap[result.label] ?? result.label;
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
  const x = rows.map((row) => row.slice(0, featureCount).map((value) => Number(value.trim())));
  if (x.some((row) => row.some((value) => Number.isNaN(value)))) {
    throw new Error("Все признаки в CSV должны быть числовыми.");
  }
  const yRaw = rows.map((row) => row[featureCount].trim());
  return { x, yRaw, featureCount };
}

async function trainTabularModel(
  modelType: ModelType,
  dataset: TabularDataset,
  onProgress: (progress: number, message: string) => void
) {
  const { x, yRaw, featureCount } = parseTabular(dataset);
  const xTensor = tf.tensor2d(x);

  if (modelType === "tabular_regression") {
    const y = yRaw.map((value) => Number(value));
    if (y.some((value) => Number.isNaN(value))) {
      throw new Error("Для регрессии целевая колонка должна быть числом.");
    }
    const yTensor = tf.tensor2d(y, [y.length, 1]);
    tabularModel?.dispose();
    tabularModel = tf.sequential({
      layers: [tf.layers.dense({ inputShape: [featureCount], units: 1 })]
    });
    tabularModel.compile({ optimizer: tf.train.adam(0.02), loss: "meanSquaredError" });
    await tabularModel.fit(xTensor, yTensor, {
      epochs: 80,
      callbacks: {
        onEpochEnd: async (epoch) => {
          onProgress(Math.round(((epoch + 1) / 80) * 100), `Эпоха ${epoch + 1}/80`);
          await tf.nextFrame();
        }
      }
    });
    tabularMode = "regression";
    classIndexToLabel = [];
    xTensor.dispose();
    yTensor.dispose();
    return;
  }

  const uniqueLabels = [...new Set(yRaw)];
  const labelToIndex = uniqueLabels.reduce<Record<string, number>>((acc, value, index) => {
    acc[value] = index;
    return acc;
  }, {});
  const yIndices = yRaw.map((value) => labelToIndex[value]);
  const yTensor = tf.oneHot(tf.tensor1d(yIndices, "int32"), uniqueLabels.length);

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
    optimizer: tf.train.adam(0.02),
    loss: "categoricalCrossentropy",
    metrics: ["accuracy"]
  });
  await tabularModel.fit(xTensor, yTensor, {
    epochs: 80,
    callbacks: {
      onEpochEnd: async (epoch) => {
        onProgress(Math.round(((epoch + 1) / 80) * 100), `Эпоха ${epoch + 1}/80`);
        await tf.nextFrame();
      }
    }
  });
  tabularMode = "classification";
  classIndexToLabel = uniqueLabels;
  xTensor.dispose();
  yTensor.dispose();
}

export async function trainByModelType(args: {
  modelType: ModelType;
  classes: DatasetClass[];
  tabularDataset: TabularDataset | null;
  onProgress: (progress: number, message: string) => void;
}) {
  if (args.modelType === "image_knn") {
    return trainKnnModel(args.classes, args.onProgress);
  }
  if (!args.tabularDataset) {
    throw new Error("Для табличной модели сначала загрузи CSV в библиотеке.");
  }
  return trainTabularModel(args.modelType, args.tabularDataset, args.onProgress);
}

function parsePredictionFeatures(input: string) {
  const values = input
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => !Number.isNaN(item));
  if (values.length === 0) {
    throw new Error("Введите признаки для предсказания, например: 1.2, 3.4, 5");
  }
  return values;
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
