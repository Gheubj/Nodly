import { useEffect, useRef, useState } from "react";
import { DatabaseOutlined, ExportOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Segmented, Space } from "antd";
import * as Blockly from "blockly";
import { useAppStore } from "@/store/useAppStore";
import type { WorkspaceLevel } from "@/store/useAppStore";
import {
  canPersistCurrentModel,
  getLastTrainedModelType,
  loadModelFromLibraryEntry,
  persistCurrentModelToLibrary,
  predictByModelType,
  trainByModelType
} from "@/features/model/mlEngine";
import type { ModelEvaluation, ModelType, SavedModelEntry, TrainingRunReport } from "@/shared/types/ai";
import { trackEvent } from "@/features/analytics/analytics";
import { useHtmlDataTheme } from "@/hooks/useHtmlDataTheme";
import type { StudioGoal } from "@/shared/types/lessonContent";
import { MiniWorkspaceGoalsOverlay } from "@/features/blockly/MiniWorkspaceGoalsOverlay";
import { stripLeadingDuplicateHeaderRows } from "@/features/data/csv";

const NODLY_BLOCKLY_DARK = Blockly.Theme.defineTheme("nodly_dark", {
  name: "nodly_dark",
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: "#141b2a",
    toolboxBackgroundColour: "#0f1624",
    toolboxForegroundColour: "#e2e8f0",
    flyoutBackgroundColour: "#151d2e",
    flyoutForegroundColour: "#cbd5e1",
    scrollbarColour: "#64748b",
    insertionMarkerColour: "#6aa3ff"
  }
});

/** Сдержанные hex: «Действия» (output) — тёмно-зелёный; «Управление» (control) — нейтральный серый. */
const BLOCK_COLOR = {
  events: "#b85c48",
  model: "#6a5ba8",
  modelTypes: "#5d5294",
  predict: "#2d8f8a",
  control: "#5a6272",
  data: "#4a6ab8",
  output: "#355f48",
  deprecated: "#7a8294",
  image: "#4d7565"
} as const;

const NODLY_BLOCKLY_LIGHT = Blockly.Theme.defineTheme("nodly_light", {
  name: "nodly_light",
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: "#e8ecf4",
    toolboxBackgroundColour: "#eef2f9",
    toolboxForegroundColour: "#334155",
    flyoutBackgroundColour: "#e9edf6",
    flyoutForegroundColour: "#475569",
    scrollbarColour: "#94a3b8",
    insertionMarkerColour: "#5b7cff"
  }
});

const DEFAULT_TRAIN_CONFIG = {
  trainSplit: 0.7,
  valSplit: 0.15,
  testSplit: 0.15,
  epochs: 80,
  learningRate: 0.001
} as const;

type BlockCommand =
  | {
      type: "train";
      modelTypeRef: string;
      datasetRef: string;
      trainSplit: number;
      valSplit: number;
      testSplit: number;
      epochs: number;
      learningRate: number;
    }
  | {
      type: "compare_models";
      datasetRef: string;
      modelCount: number;
      modelARef: string;
      modelBRef: string;
      modelCRef: string;
      trainSplit: number;
      valSplit: number;
      testSplit: number;
      epochs: number;
      learningRate: number;
    }
  | {
      type: "compare_saved_models";
      datasetRef: string;
      modelCount: number;
      modelAId: string;
      modelBId: string;
      modelCId: string;
    }
  | { type: "predict"; savedModelId: string; inputRef: string; inlineTabular: string }
  | { type: "save_model"; title: string }
  | { type: "wait"; seconds: number }
  | { type: "if"; condition: LogicExpr; thenCommands: BlockCommand[]; elseCommands: BlockCommand[] }
  | { type: "show_message"; text: string }
  | { type: "show_result" }
  | { type: "add_journal"; text: string }
  | { type: "show_eval" };

type LogicExpr =
  | { type: "bool"; value: boolean }
  | { type: "num"; value: number }
  | { type: "text"; value: string }
  | { type: "confidence" }
  | { type: "predicted_class" }
  | { type: "compare"; op: ">" | "<" | "="; left: LogicExpr; right: LogicExpr }
  | { type: "and"; left: LogicExpr; right: LogicExpr }
  | { type: "or"; left: LogicExpr; right: LogicExpr }
  | { type: "not"; value: LogicExpr };

function isImageModel(modelType: ModelType) {
  return modelType === "image_knn";
}

/** Старые проекты могли иметь невидимый блок модели в MODEL — он не должен перетирать выбор из списка. */
function getLegacyModelTypeBlock(block: Blockly.Block): Blockly.Block | null {
  const inp = block.getInput("MODEL");
  if (!inp) {
    return null;
  }
  const vis = (inp as { isVisible?: () => boolean }).isVisible?.();
  if (vis === false) {
    return null;
  }
  return block.getInputTargetBlock("MODEL");
}

function parseModelTypeRef(ref: string, fallback: ModelType = "image_knn"): ModelType {
  if (
    ref === "image_knn" ||
    ref === "tabular_regression" ||
    ref === "tabular_classification" ||
    ref === "tabular_neural" ||
    ref === "tabular_svm" ||
    ref === "tabular_random_forest" ||
    ref === "tabular_orchestrator"
  ) {
    return ref;
  }
  return fallback;
}

/** Варианты типа модели внутри блока «Обучить модель» (отдельные блоки моделей не нужны). */
function getTrainModelTypeDropdownOptions(level: 1 | 2): [string, string][] {
  if (level === 1) {
    return [
      ["Таблица: регрессия", "tabular_regression"],
      ["Таблица: классификация", "tabular_classification"],
      ["Таблица: нейросеть (MLP)", "tabular_neural"]
    ];
  }
  return [
    ["Картинки (KNN)", "image_knn"],
    ["Таблица: регрессия", "tabular_regression"],
    ["Таблица: классификация", "tabular_classification"],
    ["Таблица: нейросеть (MLP)", "tabular_neural"],
    ["Таблица: SVM (без сохранения в библиотеку)", "tabular_svm"],
    ["Таблица: Random Forest (без сохранения в библиотеку)", "tabular_random_forest"],
    ["Таблица: Оркестр моделей", "tabular_orchestrator"]
  ];
}

function getCompareModelTypeDropdownOptions(): [string, string][] {
  return [
    ["Таблица: регрессия", "tabular_regression"],
    ["Таблица: классификация", "tabular_classification"],
    ["Таблица: нейросеть (MLP)", "tabular_neural"],
    ["Таблица: SVM", "tabular_svm"],
    ["Таблица: Random Forest", "tabular_random_forest"],
    ["Таблица: Оркестр моделей", "tabular_orchestrator"],
    ["—", "__none__"]
  ];
}

function getTrainDatasetOptions(modelType: ModelType) {
  const state = useAppStore.getState();
  const merged = isImageModel(modelType)
    ? state.imageDatasets
        .filter((item) => {
          if (item.taskType === "classification") {
            return item.classes.some((c) => c.files.length > 0);
          }
          const unlabeled = item.unlabeledFiles?.length ?? 0;
          const legacy = item.classes.reduce((n, c) => n + c.files.length, 0);
          return unlabeled >= 2 || legacy >= 2;
        })
        .map((item) => [`Image: ${item.title}`, `image:${item.id}`] as [string, string])
    : state.tabularDatasets.map(
        (item) => [`Tabular: ${item.title}`, `tabular:${item.id}`] as [string, string]
      );
  return merged.length > 0 ? merged : ([["нет данных", "none"]] as [string, string][]);
}

const TABULAR_MANUAL_REF = "tabular:__manual__";
/** Уровень 1: предсказание по последней обученной модели в памяти, без записи в библиотеку. */
const SESSION_TRAINED_MODEL_ID = "__session__";

/** Порядок запуска нескольких шляп: сверху вниз, при одной высоте — слева направо. */
function sortBlocklyHatsByWorkspaceOrder(hats: Blockly.Block[]): Blockly.Block[] {
  return [...hats].sort((a, b) => {
    const pa = a.getRelativeToSurfaceXY();
    const pb = b.getRelativeToSurfaceXY();
    if (pa.y !== pb.y) {
      return pa.y - pb.y;
    }
    return pa.x - pb.x;
  });
}

function getSavedModelBlocklyOptions(): [string, string][] {
  const level = effectiveToolboxLevel(useAppStore.getState().workspaceLevel);
  const sessionOpt: [string, string] = ["после обучения (в памяти)", SESSION_TRAINED_MODEL_ID];
  if (level === 1) {
    return [sessionOpt];
  }
  const models = useAppStore.getState().savedModels;
  if (models.length === 0) {
    return [sessionOpt];
  }
  return [sessionOpt, ...models.map((m) => [`${m.title} (${m.modelType})`, m.id] as [string, string])];
}

function getSavedTabularModelBlocklyOptions(): [string, string][] {
  const models = useAppStore
    .getState()
    .savedModels.filter(
      (m) =>
        m.modelType !== "image_knn" &&
        m.modelType !== "tabular_svm" &&
        m.modelType !== "tabular_random_forest"
    );
  if (models.length === 0) {
    return [["нет сохранённых табличных моделей", "__none__"]];
  }
  return [
    ...models.map((m) => [`${m.title} (${m.modelType})`, m.id] as [string, string]),
    ["—", "__none__"]
  ];
}

function refreshCompareOptionalModelRow(block: Blockly.Block, countField: string, rowInputName: string) {
  const count = Number(block.getFieldValue(countField) ?? 3);
  const showThird = count >= 3;
  block.getInput(rowInputName)?.setVisible(showThird);
  const svg = block as Blockly.BlockSvg;
  if (svg.rendered) {
    svg.render();
  }
}

function getSavedModelEntryById(id: string): SavedModelEntry | null {
  if (!id || id === "__none__") {
    return null;
  }
  return useAppStore.getState().savedModels.find((m) => m.id === id) ?? null;
}

function getPredictModelTypeForBlock(savedModelId: string): ModelType | null {
  if (savedModelId === SESSION_TRAINED_MODEL_ID) {
    return getLastTrainedModelType();
  }
  return getSavedModelEntryById(savedModelId)?.modelType ?? null;
}

function getPredictInputOptions(savedModelId: string): [string, string][] {
  const modelType = getPredictModelTypeForBlock(savedModelId);
  if (!modelType) {
    return [["сначала обучи модель", "none"]];
  }
  const state = useAppStore.getState();
  if (isImageModel(modelType)) {
    const merged = state.imagePredictionInputs.map(
      (item) => [`Image: ${item.title}`, `image:${item.id}`] as [string, string]
    );
    return merged.length > 0 ? merged : [["нет изображения", "none"]];
  }
  const fromLibrary = state.tabularPredictionInputs.map(
    (item) => [`Таблица: ${item.title}`, `tabular:${item.id}`] as [string, string]
  );
  const manual: [string, string] = ["Вручную (строка в блоке)", TABULAR_MANUAL_REF];
  if (fromLibrary.length === 0) {
    return [manual];
  }
  return [...fromLibrary, manual];
}

/** Тип модели из блока «Обучить модель» выше по той же цепочке (ещё до запуска обучения). */
function findDeclaredModelTypeAbovePredict(predictBlock: Blockly.Block | null): ModelType | null {
  if (!predictBlock) {
    return null;
  }
  let cur: Blockly.Block | null = predictBlock.getPreviousBlock();
  while (cur) {
    if (cur.type === "noda_train_model_simple" || cur.type === "noda_train_model") {
      const legacyModel = getLegacyModelTypeBlock(cur);
      const currentRef = String(cur.getFieldValue("DATASET_REF") ?? "");
      const inferredByDataset = currentRef.startsWith("tabular:") ? "tabular_regression" : "image_knn";
      const ref = legacyModel
        ? String(legacyModel.getFieldValue("MODEL_TYPE_REF") ?? "image_knn")
        : String(cur.getFieldValue("MODEL_TYPE") ?? "image_knn");
      return parseModelTypeRef(ref, inferredByDataset as ModelType);
    }
    cur = cur.getPreviousBlock();
  }
  return null;
}

function resolvePredictL1ModelType(predictBlock: Blockly.Block | null): ModelType | null {
  return findDeclaredModelTypeAbovePredict(predictBlock) ?? getLastTrainedModelType();
}

/**
 * Уровень 1, блок «Предсказать»: источник входа по типу модели из цепочки или из памяти после обучения.
 */
function getPredictL1DataSourceOptionsForBlock(predictBlock: Blockly.Block): [string, string][] {
  const modelType = resolvePredictL1ModelType(predictBlock);
  if (!modelType) {
    return [["Соедините «Обучить модель» выше или выполните обучение", "none"]];
  }
  const state = useAppStore.getState();
  if (isImageModel(modelType)) {
    const opts = state.imagePredictionInputs.map(
      (item) => [`Из данных: ${item.title}`, `image:${item.id}`] as [string, string]
    );
    return opts.length > 0
      ? opts
      : [["Добавьте изображение в «Данные»", "none"]];
  }
  const manual: [string, string] = ["Ввести в блоке", TABULAR_MANUAL_REF];
  const fromLib = state.tabularPredictionInputs.map(
    (item) => [`Из данных: ${item.title}`, `tabular:${item.id}`] as [string, string]
  );
  if (fromLib.length === 0) {
    return [manual];
  }
  return [manual, ...fromLib];
}

function effectiveToolboxLevel(level: WorkspaceLevel): 1 | 2 {
  return level;
}

type PaletteGroupId = "events" | "data" | "model" | "predict";
type PaletteGroupIdExt = PaletteGroupId | "evaluate" | "control" | "output";

type PaletteItem = {
  type: string;
  title: string;
  group: PaletteGroupIdExt;
  shape?: "hat" | "stack" | "value";
  description?: string;
};

const PALETTE_GROUP_TITLES: Record<PaletteGroupIdExt, string> = {
  events: "События",
  data: "Данные",
  model: "Модель и обучение",
  predict: "Предсказание",
  evaluate: "Оценка",
  control: "Управление",
  output: "Действия"
};

function getPaletteItems(level: 1 | 2): PaletteItem[] {
  if (level === 1) {
    return [
      {
        type: "noda_start",
        title: "Старт",
        group: "events",
        shape: "hat",
        description:
          "Запуск сценария по клику. Несколько блоков «Старт» выполняются по очереди: выше по полю раньше, на одной линии — левее раньше."
      },
      { type: "noda_train_model_simple", title: "Обучить модель", group: "model", shape: "stack" },
      {
        type: "noda_predict_l1",
        title: "Предсказать",
        group: "predict",
        shape: "stack",
        description:
          "После обучения — сразу по этой модели. Выбери: ввести признаки строкой в блоке или строку/файл из «Данные»."
      },
      { type: "noda_if_then", title: "если ... то", group: "control", shape: "stack" },
      { type: "noda_if_then_only", title: "если ... то (без иначе)", group: "control", shape: "stack" },
      { type: "noda_wait_seconds", title: "ждать ... сек", group: "control", shape: "stack" },
      { type: "noda_op_compare", title: "[ ] > [ ]", group: "control", shape: "value" },
      { type: "noda_op_and", title: "[ ] и [ ]", group: "control", shape: "value" },
      { type: "noda_op_or", title: "[ ] или [ ]", group: "control", shape: "value" },
      { type: "noda_op_not", title: "не [ ]", group: "control", shape: "value" },
      { type: "noda_value_confidence", title: "уверенность", group: "predict", shape: "value" },
      { type: "noda_value_predicted_class", title: "предсказанный класс", group: "predict", shape: "value" },
      { type: "noda_number", title: "число", group: "data", shape: "value" },
      { type: "noda_text", title: "текст", group: "data", shape: "value" },
      { type: "noda_show_result", title: "показать результат", group: "output", shape: "stack" },
      { type: "noda_show_message", title: "показать сообщение", group: "output", shape: "stack" },
      { type: "noda_add_journal", title: "добавить в журнал", group: "output", shape: "stack" }
    ];
  }
  return [
    {
      type: "noda_start",
      title: "Старт",
      group: "events",
      shape: "hat",
      description:
        "Запуск сценария по клику. Несколько «Старт» выполняются по очереди: выше по полю раньше, на одной линии — левее раньше."
    },
    {
      type: "noda_on_trained",
      title: "когда модель обучена",
      group: "events",
      shape: "hat",
      description:
        "Цепочка после успешного обучения в основном сценарии (не из этого события). Несколько таких шляп — по очереди, в том же порядке, что на поле."
    },
    {
      type: "noda_on_predicted",
      title: "когда получено предсказание",
      group: "events",
      shape: "hat",
      description:
        "Цепочка после «Предсказать» в основном сценарии. Несколько шляп — по очереди по положению на поле. Уровень 1: блока нет в палитре."
    },
    { type: "noda_train_model", title: "Обучить модель", group: "model", shape: "stack" },
    {
      type: "noda_show_eval",
      title: "Показать оценку модели",
      group: "model",
      shape: "stack",
      description:
        "Показывает метрики последнего обучения (после «Обучить модель»). Для регрессии: MSE, MAE, RMSE, R², MedAE, max |ошибка|, sMAPE; для классификации: точность и loss."
    },
    {
      type: "noda_compare_models",
      title: "Сравнить модели",
      group: "model",
      shape: "stack",
      description:
        "Запускает несколько табличных моделей на одном датасете и показывает сравнение в «Визуализации»."
    },
    {
      type: "noda_compare_saved_models",
      title: "Сравнить сохранённые модели",
      group: "model",
      shape: "stack",
      description:
        "Сравнивает уже обученные и сохранённые табличные модели на выбранном датасете (без переобучения)."
    },
    {
      type: "noda_save_model",
      title: "Сохранить модель в библиотеку",
      group: "model",
      shape: "stack",
      description:
        "После обучения сохраняет модель в IndexedDB и список в библиотеке (вкладка «Библиотека»). Таблица: веса нейросети; картинки: примеры KNN."
    },
    {
      type: "noda_predict_class",
      title: "Предсказать",
      group: "predict",
      shape: "stack",
      description:
        "Выбери сохранённую модель из библиотеки. Вход: либо строка из библиотеки, либо «Вручную» — тогда заполни второй ряд. Для картинок — только файл из библиотеки."
    },
    { type: "noda_if_then", title: "если ... то", group: "control", shape: "stack" },
    { type: "noda_if_then_only", title: "если ... то (без иначе)", group: "control", shape: "stack" },
    { type: "noda_wait_seconds", title: "ждать ... сек", group: "control", shape: "stack" },
    { type: "noda_op_compare", title: "[ ] > [ ]", group: "control", shape: "value" },
    { type: "noda_op_and", title: "[ ] и [ ]", group: "control", shape: "value" },
    { type: "noda_op_or", title: "[ ] или [ ]", group: "control", shape: "value" },
    { type: "noda_op_not", title: "не [ ]", group: "control", shape: "value" },
    { type: "noda_value_confidence", title: "уверенность", group: "predict", shape: "value" },
    { type: "noda_value_predicted_class", title: "предсказанный класс", group: "predict", shape: "value" },
    { type: "noda_number", title: "число", group: "data", shape: "value" },
    { type: "noda_text", title: "текст", group: "data", shape: "value" },
    { type: "noda_show_result", title: "показать результат", group: "output", shape: "stack" },
    { type: "noda_show_message", title: "показать сообщение", group: "output", shape: "stack" },
    { type: "noda_add_journal", title: "добавить в журнал", group: "output", shape: "stack" }
  ];
}

function collectPaletteColors(ws: Blockly.WorkspaceSvg, level: 1 | 2): Record<string, string> {
  const next: Record<string, string> = {};
  for (const item of getPaletteItems(level)) {
    try {
      const block = ws.newBlock(item.type);
      next[item.type] = block.getColour();
      block.dispose(false);
    } catch {
      // тип ещё не зарегистрирован (например стандартные блоки до импорта)
    }
  }
  return next;
}

function refreshNodlyPredictInlineRow(block: Blockly.Block) {
  const modelType = getPredictModelTypeForBlock(String(block.getFieldValue("SAVED_MODEL_ID") ?? ""));
  const ref = block.getFieldValue("INPUT_REF");
  const manual = ref === TABULAR_MANUAL_REF || ref === "none";
  const show = !!modelType && modelType !== "image_knn" && manual;
  block.getInput("INLINE_ROW")?.setVisible(show);
  const svg = block as Blockly.BlockSvg;
  if (svg.rendered) {
    svg.render();
  }
}

/** Уровень 1: строка в блоке только для таблиц и только при выборе «Ввести в блоке». */
function refreshNodlyPredictL1InlineRow(block: Blockly.Block) {
  const modelType = resolvePredictL1ModelType(block);
  const ref = block.getFieldValue("INPUT_REF");
  const show = !!modelType && modelType !== "image_knn" && ref === TABULAR_MANUAL_REF;
  block.getInput("INLINE_ROW")?.setVisible(show);
  const svg = block as Blockly.BlockSvg;
  if (svg.rendered) {
    svg.render();
  }
}

/** Если список входов сменился (например, появился тип модели из «Обучить модель»), подправить значение поля. */
function resyncPredictL1InputDropdown(block: Blockly.Block) {
  if (block.type !== "noda_predict_l1") {
    return;
  }
  const opts = getPredictL1DataSourceOptionsForBlock(block);
  const valid = new Set(opts.map(([, v]) => v));
  const cur = String(block.getFieldValue("INPUT_REF") ?? "none");
  if (!valid.has(cur)) {
    block.setFieldValue(opts[0]?.[1] ?? "none", "INPUT_REF");
  }
  refreshNodlyPredictL1InlineRow(block);
}

function refreshAllPredictL1Blocks(workspace: Blockly.WorkspaceSvg) {
  for (const b of workspace.getAllBlocks(false)) {
    if (b.type === "noda_predict_l1") {
      resyncPredictL1InputDropdown(b);
    }
  }
}

/** Синхронизирует тип модели и валидность dataset в блоках обучения. */
function syncTrainBlockModelAndDataset(block: Blockly.Block) {
  if (block.type !== "noda_train_model_simple" && block.type !== "noda_train_model") {
    return;
  }
  const legacyModel = getLegacyModelTypeBlock(block);
  const datasetRef = String(block.getFieldValue("DATASET_REF") ?? "");
  const inferredByDataset = datasetRef.startsWith("tabular:") ? "tabular_regression" : "image_knn";
  const modelType = parseModelTypeRef(
    String(
      legacyModel?.getFieldValue("MODEL_TYPE_REF") ??
        block.getFieldValue("MODEL_TYPE") ??
        inferredByDataset
    ),
    inferredByDataset as ModelType
  );
  block.setFieldValue(modelType, "MODEL_TYPE");

  const options = getTrainDatasetOptions(modelType).map(([, value]) => value);
  const cur = String(block.getFieldValue("DATASET_REF") ?? "none");
  if (!options.includes(cur)) {
    block.setFieldValue(options[0] ?? "none", "DATASET_REF");
  }
}

function registerBlocks() {
  if (Blockly.Blocks.noda_start) {
    return;
  }
  Blockly.Blocks.noda_start = {
    init() {
      this.appendDummyInput().appendField("Старт");
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.events);
    }
  };
  Blockly.Blocks.noda_on_trained = {
    init() {
      this.appendDummyInput().appendField("когда модель обучена");
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.events);
    }
  };
  Blockly.Blocks.noda_on_predicted = {
    init() {
      this.appendDummyInput().appendField("когда получено предсказание");
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.events);
    }
  };
  /** Уровень 1: тип модели — список в блоке; скрытый MODEL — только для старых проектов с отдельным блоком модели. */
  Blockly.Blocks.noda_train_model_simple = {
    init() {
      this.appendDummyInput()
        .appendField("обучить модель")
        .appendField(
          new Blockly.FieldDropdown(() =>
            getTrainModelTypeDropdownOptions(effectiveToolboxLevel(useAppStore.getState().workspaceLevel))
          ),
          "MODEL_TYPE"
        )
        .appendField("данные")
        .appendField(
          new Blockly.FieldDropdown(function () {
            const source = this.getSourceBlock();
            const legacyModel = source ? getLegacyModelTypeBlock(source) : null;
            const currentRef = String(source?.getFieldValue("DATASET_REF") ?? "");
            const inferredByDataset = currentRef.startsWith("tabular:") ? "tabular_regression" : "image_knn";
            const modelType = parseModelTypeRef(
              String(
                legacyModel?.getFieldValue("MODEL_TYPE_REF") ??
                  source?.getFieldValue("MODEL_TYPE") ??
                  inferredByDataset
              ),
              inferredByDataset as ModelType
            );
            return getTrainDatasetOptions(modelType);
          }),
          "DATASET_REF"
        );
      this.appendValueInput("MODEL").setCheck("ModelType").setVisible(false);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.model);
      syncTrainBlockModelAndDataset(this);
      this.setOnChange(function (this: Blockly.Block, e: Blockly.Events.Abstract) {
        if (
          e.type === Blockly.Events.BLOCK_MOVE ||
          e.type === Blockly.Events.BLOCK_CHANGE ||
          e.type === Blockly.Events.BLOCK_CREATE
        ) {
          syncTrainBlockModelAndDataset(this);
        }
      });
    }
  };
  /** Уровень 2+: сплит, эпохи, lr; тип модели — список в блоке. */
  Blockly.Blocks.noda_train_model = {
    init() {
      this.appendDummyInput()
        .appendField("обучить модель")
        .appendField(
          new Blockly.FieldDropdown(() =>
            getTrainModelTypeDropdownOptions(effectiveToolboxLevel(useAppStore.getState().workspaceLevel))
          ),
          "MODEL_TYPE"
        )
        .appendField("данные")
        .appendField(
          new Blockly.FieldDropdown(function () {
            const source = this.getSourceBlock();
            const legacyModel = source ? getLegacyModelTypeBlock(source) : null;
            const currentRef = String(source?.getFieldValue("DATASET_REF") ?? "");
            const inferredByDataset = currentRef.startsWith("tabular:") ? "tabular_regression" : "image_knn";
            const modelType = parseModelTypeRef(
              String(
                legacyModel?.getFieldValue("MODEL_TYPE_REF") ??
                  source?.getFieldValue("MODEL_TYPE") ??
                  inferredByDataset
              ),
              inferredByDataset as ModelType
            );
            return getTrainDatasetOptions(modelType);
          }),
          "DATASET_REF"
        );
      this.appendDummyInput()
        .appendField("train")
        .appendField(new Blockly.FieldNumber(0.7, 0.1, 0.9, 0.05), "TRAIN_SPLIT")
        .appendField("val")
        .appendField(new Blockly.FieldNumber(0.15, 0.05, 0.4, 0.05), "VAL_SPLIT")
        .appendField("test")
        .appendField(new Blockly.FieldNumber(0.15, 0.05, 0.4, 0.05), "TEST_SPLIT");
      this.appendDummyInput()
        .appendField("epochs")
        .appendField(new Blockly.FieldNumber(80, 5, 500, 5), "EPOCHS")
        .appendField("lr")
        .appendField(new Blockly.FieldNumber(0.001, 0.0001, 1, 0.001), "LR");
      this.appendValueInput("MODEL").setCheck("ModelType").setVisible(false);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.model);
      syncTrainBlockModelAndDataset(this);
      this.setOnChange(function (this: Blockly.Block, e: Blockly.Events.Abstract) {
        if (
          e.type === Blockly.Events.BLOCK_MOVE ||
          e.type === Blockly.Events.BLOCK_CHANGE ||
          e.type === Blockly.Events.BLOCK_CREATE
        ) {
          syncTrainBlockModelAndDataset(this);
        }
      });
    }
  };
  Blockly.Blocks.noda_compare_models = {
    init() {
      this.appendDummyInput()
        .appendField("сравнить модели")
        .appendField("данные")
        .appendField(
          new Blockly.FieldDropdown(() => getTrainDatasetOptions("tabular_regression")),
          "DATASET_REF"
        );
      this.appendDummyInput()
        .appendField("кол-во")
        .appendField(new Blockly.FieldDropdown([["2", "2"], ["3", "3"]]), "MODEL_COUNT")
        .appendField("моделей");
      this.appendDummyInput()
        .appendField("A")
        .appendField(new Blockly.FieldDropdown(getCompareModelTypeDropdownOptions), "MODEL_A")
        .appendField("B")
        .appendField(new Blockly.FieldDropdown(getCompareModelTypeDropdownOptions), "MODEL_B");
      this.appendDummyInput("MODEL_C_ROW")
        .appendField("C")
        .appendField(new Blockly.FieldDropdown(getCompareModelTypeDropdownOptions), "MODEL_C");
      this.appendDummyInput()
        .appendField("train")
        .appendField(new Blockly.FieldNumber(0.7, 0.1, 0.9, 0.05), "TRAIN_SPLIT")
        .appendField("val")
        .appendField(new Blockly.FieldNumber(0.15, 0.05, 0.4, 0.05), "VAL_SPLIT")
        .appendField("test")
        .appendField(new Blockly.FieldNumber(0.15, 0.05, 0.4, 0.05), "TEST_SPLIT");
      this.appendDummyInput()
        .appendField("epochs")
        .appendField(new Blockly.FieldNumber(80, 5, 500, 5), "EPOCHS")
        .appendField("lr")
        .appendField(new Blockly.FieldNumber(0.001, 0.0001, 1, 0.001), "LR");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.model);
      refreshCompareOptionalModelRow(this, "MODEL_COUNT", "MODEL_C_ROW");
      this.setOnChange(function (this: Blockly.Block, e: Blockly.Events.Abstract) {
        if (e.type !== Blockly.Events.BLOCK_CHANGE || (e as Blockly.Events.BlockChange).blockId !== this.id) {
          return;
        }
        const ce = e as Blockly.Events.BlockChange;
        if (ce.element === "field" && ce.name === "MODEL_COUNT") {
          refreshCompareOptionalModelRow(this, "MODEL_COUNT", "MODEL_C_ROW");
        }
      });
    }
  };
  Blockly.Blocks.noda_compare_saved_models = {
    init() {
      this.appendDummyInput()
        .appendField("сравнить сохранённые модели")
        .appendField("данные")
        .appendField(
          new Blockly.FieldDropdown(() => getTrainDatasetOptions("tabular_regression")),
          "DATASET_REF"
        );
      this.appendDummyInput()
        .appendField("кол-во")
        .appendField(new Blockly.FieldDropdown([["2", "2"], ["3", "3"]]), "MODEL_COUNT")
        .appendField("моделей");
      this.appendDummyInput()
        .appendField("A")
        .appendField(new Blockly.FieldDropdown(getSavedTabularModelBlocklyOptions), "MODEL_A_ID")
        .appendField("B")
        .appendField(new Blockly.FieldDropdown(getSavedTabularModelBlocklyOptions), "MODEL_B_ID");
      this.appendDummyInput("MODEL_C_ROW")
        .appendField("C")
        .appendField(new Blockly.FieldDropdown(getSavedTabularModelBlocklyOptions), "MODEL_C_ID");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.model);
      refreshCompareOptionalModelRow(this, "MODEL_COUNT", "MODEL_C_ROW");
      this.setOnChange(function (this: Blockly.Block, e: Blockly.Events.Abstract) {
        if (e.type !== Blockly.Events.BLOCK_CHANGE || (e as Blockly.Events.BlockChange).blockId !== this.id) {
          return;
        }
        const ce = e as Blockly.Events.BlockChange;
        if (ce.element === "field" && ce.name === "MODEL_COUNT") {
          refreshCompareOptionalModelRow(this, "MODEL_COUNT", "MODEL_C_ROW");
        }
      });
    }
  };
  /** Устаревшие блоки модели: только чтобы старые проекты открывались; не в палитре. */
  Blockly.Blocks.noda_model_image_knn = {
    init() {
      this.appendDummyInput()
        .appendField("картинки (KNN)")
        .appendField(new Blockly.FieldDropdown([["image_knn", "image_knn"]]), "MODEL_TYPE_REF");
      this.setOutput(true, "ModelType");
      this.setColour(BLOCK_COLOR.image);
    }
  };
  Blockly.Blocks.noda_model_tabular_regression = {
    init() {
      this.appendDummyInput()
        .appendField("регрессия (linear)")
        .appendField(
          new Blockly.FieldDropdown([["tabular_regression", "tabular_regression"]]),
          "MODEL_TYPE_REF"
        );
      this.setOutput(true, "ModelType");
      this.setColour(BLOCK_COLOR.modelTypes);
    }
  };
  Blockly.Blocks.noda_model_tabular_classification = {
    init() {
      this.appendDummyInput()
        .appendField("классификация (логистическая)")
        .appendField(
          new Blockly.FieldDropdown([["tabular_classification", "tabular_classification"]]),
          "MODEL_TYPE_REF"
        );
      this.setOutput(true, "ModelType");
      this.setColour(BLOCK_COLOR.modelTypes);
    }
  };
  Blockly.Blocks.noda_model_tabular_neural = {
    init() {
      this.appendDummyInput()
        .appendField("нейросеть (MLP)")
        .appendField(new Blockly.FieldDropdown([["tabular_neural", "tabular_neural"]]), "MODEL_TYPE_REF");
      this.setOutput(true, "ModelType");
      this.setColour(BLOCK_COLOR.modelTypes);
    }
  };
  /** Устаревший тип: оставлен только чтобы старые проекты открывались; не показывается в палитре. */
  Blockly.Blocks.noda_set_predict_input = {
    init() {
      this.appendDummyInput().appendField("Удали блок — ввод в «Предсказать»");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.deprecated);
    }
  };
  Blockly.Blocks.noda_save_model = {
    init() {
      this.appendDummyInput()
        .appendField("сохранить модель")
        .appendField(new Blockly.FieldTextInput("Моя модель"), "SAVE_TITLE");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.model);
    }
  };
  Blockly.Blocks.noda_predict_class = {
    init() {
      const block = this;
      this.appendDummyInput()
        .appendField("предсказать")
        .appendField(
          new Blockly.FieldDropdown(function () {
            return getSavedModelBlocklyOptions();
          }),
          "SAVED_MODEL_ID"
        )
        .appendField("вход")
        .appendField(
          new Blockly.FieldDropdown(function () {
            const savedModelId = String(this.getSourceBlock()?.getFieldValue("SAVED_MODEL_ID") ?? "__none__");
            return getPredictInputOptions(savedModelId);
          }),
          "INPUT_REF"
        );
      this.appendDummyInput("INLINE_ROW")
        .appendField("если вручную — признаки")
        .appendField(new Blockly.FieldTextInput("5.1,3.5,1.4,0.2"), "INLINE_TABULAR");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.predict);
      refreshNodlyPredictInlineRow(block);
      this.setOnChange(function (this: Blockly.Block, e: Blockly.Events.Abstract) {
        if (e.type !== Blockly.Events.BLOCK_CHANGE || (e as Blockly.Events.BlockChange).blockId !== this.id) {
          return;
        }
        const ce = e as Blockly.Events.BlockChange;
        if (ce.element === "field" && (ce.name === "INPUT_REF" || ce.name === "SAVED_MODEL_ID")) {
          refreshNodlyPredictInlineRow(this);
        }
      });
    }
  };
  /** Уровень 1: только вход (строка в блоке или из «Данные»), модель — последняя обученная. */
  Blockly.Blocks.noda_predict_l1 = {
    init() {
      const block = this;
      this.appendDummyInput()
        .appendField("предсказать")
        .appendField(
          new Blockly.FieldDropdown(function (this: Blockly.Field<string>) {
            const src = this.getSourceBlock();
            return src ? getPredictL1DataSourceOptionsForBlock(src) : [["—", "none"]];
          }),
          "INPUT_REF"
        );
      this.appendDummyInput("INLINE_ROW")
        .appendField("строка через запятую")
        .appendField(new Blockly.FieldTextInput("5.1,3.5,1.4,0.2"), "INLINE_TABULAR");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.predict);
      refreshNodlyPredictL1InlineRow(block);
      this.setOnChange(function (this: Blockly.Block, e: Blockly.Events.Abstract) {
        if (e.type !== Blockly.Events.BLOCK_CHANGE || (e as Blockly.Events.BlockChange).blockId !== this.id) {
          return;
        }
        const ce = e as Blockly.Events.BlockChange;
        if (ce.element === "field" && ce.name === "INPUT_REF") {
          refreshNodlyPredictL1InlineRow(this);
        }
      });
    }
  };
  Blockly.Blocks.noda_wait_seconds = {
    init() {
      this.appendDummyInput()
        .appendField("ждать")
        .appendField(new Blockly.FieldNumber(1, 0, 120, 0.5), "SECONDS")
        .appendField("сек");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.control);
    }
  };
  Blockly.Blocks.noda_if_then = {
    init() {
      this.appendValueInput("COND").appendField("если");
      this.appendStatementInput("THEN").appendField("то");
      this.appendStatementInput("ELSE").appendField("иначе");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.control);
    }
  };
  Blockly.Blocks.noda_if_then_only = {
    init() {
      this.appendValueInput("COND").appendField("если");
      this.appendStatementInput("THEN").appendField("то");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.control);
    }
  };
  Blockly.Blocks.noda_op_compare = {
    init() {
      this.appendValueInput("A");
      this.appendDummyInput().appendField(new Blockly.FieldDropdown([[" >", ">"], ["<", "<"], ["=", "="]]), "OP");
      this.appendValueInput("B");
      this.setOutput(true, "Boolean");
      this.setColour(BLOCK_COLOR.control);
    }
  };
  Blockly.Blocks.noda_op_and = {
    init() {
      this.appendValueInput("A");
      this.appendDummyInput().appendField("и");
      this.appendValueInput("B");
      this.setOutput(true, "Boolean");
      this.setColour(BLOCK_COLOR.control);
    }
  };
  Blockly.Blocks.noda_op_or = {
    init() {
      this.appendValueInput("A");
      this.appendDummyInput().appendField("или");
      this.appendValueInput("B");
      this.setOutput(true, "Boolean");
      this.setColour(BLOCK_COLOR.control);
    }
  };
  Blockly.Blocks.noda_op_not = {
    init() {
      this.appendDummyInput().appendField("не");
      this.appendValueInput("A");
      this.setOutput(true, "Boolean");
      this.setColour(BLOCK_COLOR.control);
    }
  };
  Blockly.Blocks.noda_value_confidence = {
    init() {
      this.appendDummyInput().appendField("уверенность");
      this.setOutput(true, "Number");
      this.setColour(BLOCK_COLOR.predict);
    }
  };
  Blockly.Blocks.noda_value_predicted_class = {
    init() {
      this.appendDummyInput().appendField("предсказанный класс");
      this.setOutput(true, "String");
      this.setColour(BLOCK_COLOR.predict);
    }
  };
  Blockly.Blocks.noda_number = {
    init() {
      this.appendDummyInput().appendField(new Blockly.FieldNumber(0), "NUM");
      this.setOutput(true, "Number");
      this.setColour(BLOCK_COLOR.data);
    }
  };
  Blockly.Blocks.noda_text = {
    init() {
      this.appendDummyInput().appendField(new Blockly.FieldTextInput("текст"), "TEXT");
      this.setOutput(true, "String");
      this.setColour(BLOCK_COLOR.data);
    }
  };
  Blockly.Blocks.noda_show_message = {
    init() {
      this.appendDummyInput()
        .appendField("показать сообщение")
        .appendField(new Blockly.FieldTextInput("Готово!"), "TEXT");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.output);
    }
  };
  Blockly.Blocks.noda_show_result = {
    init() {
      this.appendDummyInput().appendField("показать результат");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.output);
    }
  };
  Blockly.Blocks.noda_add_journal = {
    init() {
      this.appendDummyInput()
        .appendField("добавить в журнал")
        .appendField(new Blockly.FieldTextInput("Шаг выполнен"), "TEXT");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.output);
    }
  };
  Blockly.Blocks.noda_show_eval = {
    init() {
      this.appendDummyInput().appendField("показать оценку модели");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.model);
    }
  };
}

function getDefaultWorkspaceJson(trainBlockType: "noda_train_model_simple" | "noda_train_model") {
  const blocks: Record<string, unknown>[] = [
    { type: "noda_start", x: 20, y: 20 },
    { type: trainBlockType, x: 20, y: 100 }
  ];
  if (trainBlockType === "noda_train_model") {
    blocks.push({ type: "noda_predict_class", x: 20, y: 180 });
  } else {
    blocks.push({ type: "noda_predict_l1", x: 20, y: 180 });
  }
  return {
    blocks: {
      languageVersion: 0,
      blocks
    }
  };
}

export type BlocklyWorkspaceProps = {
  /** Мини-студия в уроке: без переключателя уровней, с кнопкой «Данные» как в полной студии */
  miniStudioToolbar?: boolean;
  /** Ссылка «Во вкладке» — обычная разработка с тем же `project`, без `embed` / `mini`. */
  standaloneStudioHref?: string;
  miniCoachGoals?: {
    goals: StudioGoal[];
    goalStatus: Record<string, boolean>;
    allGoalsDone: boolean;
  };
  onOpenDataLibrary?: () => void;
  onSaveProject?: () => void;
  onMiniStudioActivity?: (event: {
    type: "train" | "predict";
    modelType: string;
    datasetRef?: string;
    inputRef?: string;
    label?: string | null;
  }) => void;
};

export function BlocklyWorkspace({
  miniStudioToolbar,
  standaloneStudioHref,
  miniCoachGoals,
  onOpenDataLibrary,
  onSaveProject,
  onMiniStudioActivity
}: BlocklyWorkspaceProps = {}) {
  const htmlTheme = useHtmlDataTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const miniToolbarRef = useRef(Boolean(miniStudioToolbar));
  useEffect(() => {
    miniToolbarRef.current = Boolean(miniStudioToolbar);
  }, [miniStudioToolbar]);
  const isRunningRef = useRef(false);
  const { blocklyState, workspaceLevel, setWorkspaceLevel } = useAppStore();

  const paletteLevel = effectiveToolboxLevel(workspaceLevel);
  const paletteItems = getPaletteItems(paletteLevel);
  const [paletteColors, setPaletteColors] = useState<Record<string, string>>({});

  useEffect(() => {
    const ws = workspaceRef.current;
    if (!ws) {
      return;
    }
    const level = effectiveToolboxLevel(useAppStore.getState().workspaceLevel);
    setPaletteColors(collectPaletteColors(ws, level));
  }, [workspaceLevel]);

  const spawnBlock = (type: string) => {
    const ws = workspaceRef.current;
    if (!ws) {
      return;
    }
    const block = ws.newBlock(type);
    block.initSvg();
    block.render();
    const anyWs = ws as any;
    const metrics = typeof anyWs.getMetrics === "function" ? anyWs.getMetrics() : null;
    const x = metrics ? metrics.viewLeft + 40 : 40;
    const yBase = metrics ? metrics.viewTop + 40 : 40;
    const y = yBase + spawnOffsetRef.current;
    block.moveBy(x, y);
    block.select();
    spawnOffsetRef.current += 56;
    if (spawnOffsetRef.current > 320) {
      spawnOffsetRef.current = 0;
    }
  };

  const clampBlocksToViewport = (workspace: Blockly.WorkspaceSvg) => {
    const blocks = workspace.getAllBlocks(false);
    const MIN_X = 16;
    const MIN_Y = -Infinity;
    for (const block of blocks) {
      const xy = block.getRelativeToSurfaceXY();
      let dx = 0;
      let dy = 0;
      if (xy.x < MIN_X) {
        dx = MIN_X - xy.x;
      }
      if (xy.y < MIN_Y) {
        dy = MIN_Y - xy.y;
      }
      if (dx !== 0 || dy !== 0) {
        block.moveBy(dx, dy);
      }
    }
  };

  const parseExpr = (block: Blockly.Block | null): LogicExpr => {
    if (!block) {
      return { type: "bool", value: false };
    }
    if (block.type === "math_number" || block.type === "noda_number") {
      return { type: "num", value: Number(block.getFieldValue("NUM")) || 0 };
    }
    if (block.type === "text" || block.type === "noda_text") {
      return { type: "text", value: String(block.getFieldValue("TEXT") ?? "") };
    }
    if (block.type === "noda_value_confidence") {
      return { type: "confidence" };
    }
    if (block.type === "noda_value_predicted_class") {
      return { type: "predicted_class" };
    }
    if (block.type === "noda_op_compare") {
      return {
        type: "compare",
        op: (block.getFieldValue("OP") as ">" | "<" | "=") || ">",
        left: parseExpr(block.getInputTargetBlock("A")),
        right: parseExpr(block.getInputTargetBlock("B"))
      };
    }
    if (block.type === "noda_op_and") {
      return {
        type: "and",
        left: parseExpr(block.getInputTargetBlock("A")),
        right: parseExpr(block.getInputTargetBlock("B"))
      };
    }
    if (block.type === "noda_op_or") {
      return {
        type: "or",
        left: parseExpr(block.getInputTargetBlock("A")),
        right: parseExpr(block.getInputTargetBlock("B"))
      };
    }
    if (block.type === "noda_op_not") {
      return {
        type: "not",
        value: parseExpr(block.getInputTargetBlock("A"))
      };
    }
    return { type: "bool", value: false };
  };

  const parseCommandChain = (first: Blockly.Block | null): BlockCommand[] => {
    const commands: BlockCommand[] = [];
    let current = first;
    while (current) {
      if (current.type === "noda_train_model_simple") {
        const legacyModel = getLegacyModelTypeBlock(current);
        const modelTypeRef = String(
          legacyModel?.getFieldValue("MODEL_TYPE_REF") ??
            current.getFieldValue("MODEL_TYPE") ??
            "image_knn"
        );
        commands.push({
          type: "train",
          modelTypeRef,
          datasetRef: current.getFieldValue("DATASET_REF"),
          ...DEFAULT_TRAIN_CONFIG
        });
      } else if (current.type === "noda_train_model") {
        const legacyModel = getLegacyModelTypeBlock(current);
        const modelTypeRef = String(
          legacyModel?.getFieldValue("MODEL_TYPE_REF") ??
            current.getFieldValue("MODEL_TYPE") ??
            "image_knn"
        );
        commands.push({
          type: "train",
          modelTypeRef,
          datasetRef: current.getFieldValue("DATASET_REF"),
          trainSplit: Number(current.getFieldValue("TRAIN_SPLIT")) || 0.7,
          valSplit: Number(current.getFieldValue("VAL_SPLIT")) || 0.15,
          testSplit: Number(current.getFieldValue("TEST_SPLIT")) || 0.15,
          epochs: Number(current.getFieldValue("EPOCHS")) || 80,
          learningRate: Number(current.getFieldValue("LR")) || 0.001
        });
      } else if (current.type === "noda_compare_models") {
        commands.push({
          type: "compare_models",
          datasetRef: current.getFieldValue("DATASET_REF"),
          modelCount: Math.max(2, Math.min(3, Number(current.getFieldValue("MODEL_COUNT")) || 3)),
          modelARef: String(current.getFieldValue("MODEL_A") ?? "__none__"),
          modelBRef: String(current.getFieldValue("MODEL_B") ?? "__none__"),
          modelCRef: String(current.getFieldValue("MODEL_C") ?? "__none__"),
          trainSplit: Number(current.getFieldValue("TRAIN_SPLIT")) || 0.7,
          valSplit: Number(current.getFieldValue("VAL_SPLIT")) || 0.15,
          testSplit: Number(current.getFieldValue("TEST_SPLIT")) || 0.15,
          epochs: Number(current.getFieldValue("EPOCHS")) || 80,
          learningRate: Number(current.getFieldValue("LR")) || 0.001
        });
      } else if (current.type === "noda_compare_saved_models") {
        commands.push({
          type: "compare_saved_models",
          datasetRef: current.getFieldValue("DATASET_REF"),
          modelCount: Math.max(2, Math.min(3, Number(current.getFieldValue("MODEL_COUNT")) || 3)),
          modelAId: String(current.getFieldValue("MODEL_A_ID") ?? "__none__"),
          modelBId: String(current.getFieldValue("MODEL_B_ID") ?? "__none__"),
          modelCId: String(current.getFieldValue("MODEL_C_ID") ?? "__none__")
        });
      } else if (current.type === "noda_save_model") {
        commands.push({
          type: "save_model",
          title: String(current.getFieldValue("SAVE_TITLE") ?? "")
        });
      } else if (current.type === "noda_predict_class") {
        const savedModelId = String(current.getFieldValue("SAVED_MODEL_ID") ?? "");
        if (!savedModelId || savedModelId === "__none__") {
          throw new Error("В блоке «Предсказать» выбери модель из списка.");
        }
        commands.push({
          type: "predict",
          savedModelId,
          inputRef: current.getFieldValue("INPUT_REF"),
          inlineTabular: String(
            current.getFieldValue("INLINE_TABULAR") ?? ""
          ).trim()
        });
      } else if (current.type === "noda_predict_l1") {
        const inputRef = String(current.getFieldValue("INPUT_REF") ?? "none");
        if (inputRef === "none") {
          throw new Error("В блоке «Предсказать» выбери источник входных данных.");
        }
        commands.push({
          type: "predict",
          savedModelId: SESSION_TRAINED_MODEL_ID,
          inputRef,
          inlineTabular: String(
            current.getFieldValue("INLINE_TABULAR") ?? ""
          ).trim()
        });
      } else if (current.type === "noda_wait_seconds") {
        commands.push({ type: "wait", seconds: Number(current.getFieldValue("SECONDS")) || 0 });
      } else if (current.type === "noda_if_then") {
        commands.push({
          type: "if",
          condition: parseExpr(current.getInputTargetBlock("COND")),
          thenCommands: parseCommandChain(current.getInputTargetBlock("THEN")),
          elseCommands: parseCommandChain(current.getInputTargetBlock("ELSE"))
        });
      } else if (current.type === "noda_if_then_only") {
        commands.push({
          type: "if",
          condition: parseExpr(current.getInputTargetBlock("COND")),
          thenCommands: parseCommandChain(current.getInputTargetBlock("THEN")),
          elseCommands: []
        });
      } else if (current.type === "noda_show_message") {
        commands.push({ type: "show_message", text: String(current.getFieldValue("TEXT") ?? "") });
      } else if (current.type === "noda_show_result") {
        commands.push({ type: "show_result" });
      } else if (current.type === "noda_add_journal") {
        commands.push({ type: "add_journal", text: String(current.getFieldValue("TEXT") ?? "") });
      } else if (current.type === "noda_show_eval") {
        commands.push({ type: "show_eval" });
      }
      current = current.getNextBlock();
    }
    return commands;
  };

  const collectCommandChainsFromHatType = (hatType: string): BlockCommand[][] => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return [];
    }
    const hats = sortBlocklyHatsByWorkspaceOrder(
      workspace.getTopBlocks(true).filter((block) => block.type === hatType && block.isEnabled())
    );
    return hats.map((hat) => parseCommandChain(hat.getNextBlock())).filter((chain) => chain.length > 0);
  };

  const runEventChain = async (kind: "trained" | "predicted") => {
    const ws = workspaceRef.current;
    if (!ws) {
      return;
    }
    const level = effectiveToolboxLevel(useAppStore.getState().workspaceLevel);
    if (level === 1) {
      return;
    }
    const hatType = kind === "trained" ? "noda_on_trained" : "noda_on_predicted";
    const chains = collectCommandChainsFromHatType(hatType);
    for (const commands of chains) {
      await executeCommands(commands, { fromEvent: true });
    }
  };

  const lastEvaluationRef = useRef<ModelEvaluation | null>(null);
  const spawnOffsetRef = useRef(0);
  const loadedSavedModelIdRef = useRef<string | null>(null);

  const resolveExpr = (expr: LogicExpr): string | number | boolean => {
    const state = useAppStore.getState();
    if (expr.type === "bool") {
      return expr.value;
    }
    if (expr.type === "num") {
      return expr.value;
    }
    if (expr.type === "text") {
      return expr.value;
    }
    if (expr.type === "confidence") {
      return state.prediction?.confidence ?? 0;
    }
    if (expr.type === "predicted_class") {
      return state.prediction?.title ?? "";
    }
    if (expr.type === "not") {
      return !Boolean(resolveExpr(expr.value));
    }
    if (expr.type === "and") {
      return Boolean(resolveExpr(expr.left)) && Boolean(resolveExpr(expr.right));
    }
    if (expr.type === "or") {
      return Boolean(resolveExpr(expr.left)) || Boolean(resolveExpr(expr.right));
    }
    if (expr.type === "compare") {
      const left = resolveExpr(expr.left);
      const right = resolveExpr(expr.right);
      const numLeft = Number(left);
      const numRight = Number(right);
      const bothNum = !Number.isNaN(numLeft) && !Number.isNaN(numRight);
      if (expr.op === "=") {
        return String(left) === String(right);
      }
      if (!bothNum) {
        return false;
      }
      return expr.op === ">" ? numLeft > numRight : numLeft < numRight;
    }
    return false;
  };

  const uniqueModelTypesForComparison = (refs: string[]): ModelType[] => {
    const out: ModelType[] = [];
    for (const ref of refs) {
      if (!ref || ref === "__none__") {
        continue;
      }
      const mt = parseModelTypeRef(ref, "tabular_regression");
      if (mt === "image_knn") {
        continue;
      }
      if (!out.includes(mt)) {
        out.push(mt);
      }
    }
    return out;
  };

  const uniqueSavedModelEntriesForComparison = (ids: string[]): SavedModelEntry[] => {
    const map = new Map<string, SavedModelEntry>();
    const saved = useAppStore.getState().savedModels;
    for (const id of ids) {
      if (!id || id === "__none__") {
        continue;
      }
      const entry = saved.find((m) => m.id === id);
      if (!entry || entry.modelType === "image_knn") {
        continue;
      }
      map.set(entry.id, entry);
    }
    return [...map.values()];
  };

  const universalScoreFromMetrics = (modelType: ModelType, metrics: Record<string, number>): number => {
    if (modelType !== "tabular_regression") {
      const acc = metrics.testAccuracy;
      return Number.isFinite(acc) ? Math.max(0, Math.min(1, acc)) : 0;
    }
    const mae = metrics.testMAE;
    if (Number.isFinite(mae) && mae >= 0 && mae <= 1.2) {
      return Math.max(0, Math.min(1, 1 - mae));
    }
    const r2 = metrics.testR2;
    if (Number.isFinite(r2)) {
      return Math.max(0, Math.min(1, (r2 + 1) / 2));
    }
    const rmse = metrics.testRMSE;
    if (Number.isFinite(rmse)) {
      return 1 / (1 + Math.max(0, rmse));
    }
    return 0;
  };

  const parseRegressionTarget = (raw: string): number => {
    const t = raw.trim().replace(/\s/g, "").replace(",", ".");
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  };

  const evaluateLoadedSavedModelOnDataset = async (
    entry: SavedModelEntry,
    datasetRef: string,
    onProgress: (progress: number, message: string) => void
  ): Promise<{
    modelType: ModelType;
    kind: "tabular_classification" | "tabular_regression";
    summary: string;
    primaryMetricKey: string;
    primaryMetricValue: number;
    universalScore: number;
    evaluation: ModelEvaluation;
    report: TrainingRunReport;
  }> => {
    const state = useAppStore.getState();
    const dsId = datasetRef.startsWith("tabular:") ? datasetRef.slice("tabular:".length) : "";
    const ds = state.tabularDatasets.find((d) => d.id === dsId)?.dataset;
    if (!ds) {
      throw new Error("Датасет для сравнения сохранённых моделей не найден.");
    }
    const rows = stripLeadingDuplicateHeaderRows(ds.headers ?? [], ds.rows);
    if (rows.length < 2) {
      throw new Error("Для сравнения нужно минимум 2 строки в табличном датасете.");
    }
    const colCount = Math.max(ds.headers?.length ?? 0, ...rows.map((r) => r.length), 1);
    const targetIndex = Math.min(
      colCount - 1,
      Math.max(0, Number.isFinite(Number(ds.targetColumnIndex)) ? Math.trunc(Number(ds.targetColumnIndex)) : colCount - 1)
    );
    const padded = rows.map((r) => {
      const out = [...r];
      while (out.length < colCount) {
        out.push("");
      }
      return out.slice(0, colCount);
    });
    await loadModelFromLibraryEntry(entry);
    const yTrueRaw = padded.map((r) => r[targetIndex]!.trim());
    const xRows = padded.map((r) => r.filter((_, i) => i !== targetIndex).join(","));
    const preds: Array<string | number> = [];
    for (let i = 0; i < xRows.length; i++) {
      const pred = await predictByModelType({
        modelType: entry.modelType,
        predictionFile: null,
        labelsMap: {},
        tabularInput: xRows[i]!
      });
      if (!pred) {
        throw new Error("Не удалось получить предсказание сохранённой модели.");
      }
      if (entry.modelType === "tabular_regression") {
        const v = Number(String(pred.title).replace(/^Прогноз:\s*/i, "").replace(",", "."));
        preds.push(Number.isFinite(v) ? v : NaN);
      } else {
        preds.push(pred.labelId);
      }
      if (i % 10 === 0 || i === xRows.length - 1) {
        onProgress(Math.round(((i + 1) / xRows.length) * 100), `Оценка ${entry.title}: ${i + 1}/${xRows.length}`);
      }
    }
    if (entry.modelType === "tabular_regression") {
      const yTrue = yTrueRaw.map(parseRegressionTarget);
      const yPred = preds.map((v) => Number(v));
      const valid: Array<{ yt: number; yp: number }> = [];
      for (let i = 0; i < yTrue.length; i++) {
        if (Number.isFinite(yTrue[i]!) && Number.isFinite(yPred[i]!)) {
          valid.push({ yt: yTrue[i]!, yp: yPred[i]! });
        }
      }
      if (valid.length < 1) {
        throw new Error(`Сравнение ${entry.title}: целевая колонка нечисловая для регрессии.`);
      }
      const n = valid.length;
      const mse = valid.reduce((s, r) => s + (r.yt - r.yp) ** 2, 0) / n;
      const mae = valid.reduce((s, r) => s + Math.abs(r.yt - r.yp), 0) / n;
      const rmse = Math.sqrt(mse);
      const mean = valid.reduce((s, r) => s + r.yt, 0) / n;
      const sst = valid.reduce((s, r) => s + (r.yt - mean) ** 2, 0);
      const sse = valid.reduce((s, r) => s + (r.yt - r.yp) ** 2, 0);
      const r2 = sst > 1e-12 ? 1 - sse / sst : 0;
      const metrics = { testMSE: mse, testMAE: mae, testRMSE: rmse, testR2: r2 };
      const summary = `Сохранённая модель: RMSE ${rmse.toFixed(4)}, MAE ${mae.toFixed(4)}, R² ${r2.toFixed(4)}`;
      const report: TrainingRunReport = {
        kind: "tabular_regression",
        modelType: entry.modelType,
        summary,
        metrics,
        epochHistory: [],
        regressionExamples: valid.slice(0, 8).map((r) => ({
          trueY: r.yt,
          predictedY: r.yp,
          absError: Math.abs(r.yt - r.yp)
        }))
      };
      return {
        modelType: entry.modelType,
        kind: "tabular_regression",
        summary,
        primaryMetricKey: "testRMSE",
        primaryMetricValue: rmse,
        universalScore: universalScoreFromMetrics(entry.modelType, metrics),
        evaluation: { summary, metrics },
        report
      };
    }
    const n = Math.min(yTrueRaw.length, preds.length);
    let correct = 0;
    const confusion = new Map<string, Map<string, number>>();
    const examples: Array<{ trueLabel: string; predictedLabel: string; confidence: number }> = [];
    for (let i = 0; i < n; i++) {
      const yt = yTrueRaw[i]!;
      const yp = String(preds[i] ?? "");
      if (yt === yp) {
        correct += 1;
      }
      if (!confusion.has(yt)) {
        confusion.set(yt, new Map<string, number>());
      }
      const row = confusion.get(yt)!;
      row.set(yp, (row.get(yp) ?? 0) + 1);
      if (examples.length < 8) {
        examples.push({ trueLabel: yt, predictedLabel: yp, confidence: Number(yt === yp) });
      }
    }
    const labels = [...new Set([...yTrueRaw, ...preds.map((p) => String(p ?? ""))])];
    const matrix = labels.map((t) => labels.map((p) => confusion.get(t)?.get(p) ?? 0));
    const acc = n > 0 ? correct / n : 0;
    const metrics = { testAccuracy: acc, testLoss: 1 - acc };
    const summary = `Сохранённая модель: accuracy ${(acc * 100).toFixed(1)}%`;
    const report: TrainingRunReport = {
      kind: "tabular_classification",
      modelType: entry.modelType,
      summary,
      metrics,
      epochHistory: [],
      confusionMatrix: { labels, matrix },
      classificationExamples: examples
    };
    return {
      modelType: entry.modelType,
      kind: "tabular_classification",
      summary,
      primaryMetricKey: "testAccuracy",
      primaryMetricValue: acc,
      universalScore: universalScoreFromMetrics(entry.modelType, metrics),
      evaluation: { summary, metrics },
      report
    };
  };

  const executeCommands = async (commands: BlockCommand[], options?: { fromEvent?: boolean }) => {
    const fromEvent = options?.fromEvent ?? false;
    const state = useAppStore.getState();
    const journal: string[] = [];
    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    for (const command of commands) {
      if (command.type === "if") {
        const pass = Boolean(resolveExpr(command.condition));
        await executeCommands(pass ? command.thenCommands : command.elseCommands, { fromEvent: true });
        continue;
      }
      if (command.type === "compare_models") {
        const [kind, id] = command.datasetRef.split(":");
        if (kind !== "tabular") {
          throw new Error("Для сравнения моделей выбери tabular dataset.");
        }
        const tabularDataset = state.tabularDatasets.find((item) => item.id === id)?.dataset ?? null;
        if (!tabularDataset) {
          throw new Error("Датасет для сравнения не найден.");
        }
        const modelRefs = [command.modelARef, command.modelBRef];
        if (command.modelCount >= 3) {
          modelRefs.push(command.modelCRef);
        }
        const modelTypes = uniqueModelTypesForComparison(modelRefs);
        if (modelTypes.length < 2) {
          throw new Error("Выбери минимум 2 разные модели для сравнения.");
        }
        state.setModelComparisonReport(null);
        state.setTraining({
          isTraining: true,
          progress: 0,
          message: `Сравнение моделей: 0/${modelTypes.length}`,
          coachMood: "working"
        });
        const compareRows: Array<{
          modelType: ModelType;
          kind: "tabular_classification" | "tabular_regression";
          summary: string;
          primaryMetricKey: string;
          primaryMetricValue: number;
          universalScore: number;
          evaluation: ModelEvaluation;
          report: TrainingRunReport;
        }> = [];
        for (let i = 0; i < modelTypes.length; i++) {
          const modelType = modelTypes[i]!;
          state.setTraining({
            progress: Math.round((i / modelTypes.length) * 100),
            message: `Сравнение: ${modelType} (${i + 1}/${modelTypes.length})`,
            coachMood: "working"
          });
          const outcome = await trainByModelType({
            modelType,
            imageDataset: null,
            tabularDataset,
            config: {
              trainSplit: command.trainSplit,
              valSplit: command.valSplit,
              testSplit: command.testSplit,
              epochs: command.epochs,
              learningRate: command.learningRate
            },
            onProgress: (progress, message) => {
              const base = (i / modelTypes.length) * 100;
              const portion = progress / modelTypes.length;
              state.setTraining({
                progress: Math.min(100, Math.round(base + portion)),
                message: `Сравнение: ${message}`,
                coachMood: "working"
              });
            }
          });
          const primaryMetricKey = modelType === "tabular_regression" ? "testRMSE" : "testAccuracy";
          const primaryMetricValue = Number(outcome.evaluation.metrics[primaryMetricKey] ?? 0);
          const universalScore = universalScoreFromMetrics(modelType, outcome.evaluation.metrics);
          compareRows.push({
            modelType,
            kind: modelType === "tabular_regression" ? "tabular_regression" : "tabular_classification",
            summary: outcome.evaluation.summary,
            primaryMetricKey,
            primaryMetricValue,
            universalScore,
            evaluation: outcome.evaluation,
            report: outcome.report
          });
        }
        compareRows.sort((a, b) => b.universalScore - a.universalScore);
        const best = compareRows[0];
        const comparisonReport = {
          datasetRef: command.datasetRef,
          rows: compareRows.map((r) => ({
            modelType: r.modelType,
            kind: r.kind,
            summary: r.summary,
            primaryMetricKey: r.primaryMetricKey,
            primaryMetricValue: r.primaryMetricValue,
            universalScore: r.universalScore,
            metrics: r.evaluation.metrics,
            epochHistory: r.report.epochHistory,
            confusionMatrix: r.report.confusionMatrix,
            classificationExamples: r.report.classificationExamples,
            regressionExamples: r.report.regressionExamples
          })),
          bestModelType: best?.modelType ?? null,
          generatedAt: new Date().toISOString()
        };
        state.setModelComparisonReport(comparisonReport);
        if (best) {
          state.setEvaluation(best.evaluation);
          state.setTrainingRunReport(best.report);
          state.setLastModelType(best.modelType);
          lastEvaluationRef.current = best.evaluation;
        }
        state.setPrediction(null);
        const duringCompare = useAppStore.getState().training.scenarioActive;
        state.setTraining({
          isTraining: false,
          progress: 100,
          message: best
            ? `Сравнение готово. Лучшая модель: ${best.modelType} (score ${(best.universalScore * 100).toFixed(1)}%)`
            : "Сравнение готово",
          coachMood: duringCompare ? "working" : "success"
        });
        if (!fromEvent) {
          await runEventChain("trained");
        }
        continue;
      }
      if (command.type === "compare_saved_models") {
        const modelIds = [command.modelAId, command.modelBId];
        if (command.modelCount >= 3) {
          modelIds.push(command.modelCId);
        }
        const entries = uniqueSavedModelEntriesForComparison(modelIds);
        if (entries.length < 2) {
          throw new Error("Выбери минимум 2 сохранённые табличные модели для сравнения.");
        }
        state.setModelComparisonReport(null);
        state.setTraining({
          isTraining: true,
          progress: 0,
          message: `Сравнение сохранённых моделей: 0/${entries.length}`,
          coachMood: "working"
        });
        const compareRows: Array<{
          modelType: ModelType;
          kind: "tabular_classification" | "tabular_regression";
          summary: string;
          primaryMetricKey: string;
          primaryMetricValue: number;
          universalScore: number;
          evaluation: ModelEvaluation;
          report: TrainingRunReport;
        }> = [];
        const failed: string[] = [];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]!;
          try {
            const outcome = await evaluateLoadedSavedModelOnDataset(entry, command.datasetRef, (progress, message) => {
              const base = (i / entries.length) * 100;
              const portion = progress / entries.length;
              state.setTraining({
                progress: Math.min(100, Math.round(base + portion)),
                message,
                coachMood: "working"
              });
            });
            compareRows.push(outcome);
          } catch {
            failed.push(entry.title);
          }
        }
        if (compareRows.length < 2) {
          throw new Error("Не удалось сравнить минимум 2 сохранённые модели. Проверь, что это tabular TF-модели.");
        }
        compareRows.sort((a, b) => b.universalScore - a.universalScore);
        const best = compareRows[0];
        state.setModelComparisonReport({
          datasetRef: command.datasetRef,
          rows: compareRows.map((r) => ({
            modelType: r.modelType,
            kind: r.kind,
            summary: r.summary,
            primaryMetricKey: r.primaryMetricKey,
            primaryMetricValue: r.primaryMetricValue,
            universalScore: r.universalScore,
            metrics: r.evaluation.metrics,
            epochHistory: r.report.epochHistory,
            confusionMatrix: r.report.confusionMatrix,
            classificationExamples: r.report.classificationExamples,
            regressionExamples: r.report.regressionExamples
          })),
          bestModelType: best?.modelType ?? null,
          generatedAt: new Date().toISOString()
        });
        if (best) {
          state.setEvaluation(best.evaluation);
          state.setTrainingRunReport(best.report);
          state.setLastModelType(best.modelType);
          lastEvaluationRef.current = best.evaluation;
        }
        state.setPrediction(null);
        const duringCompare = useAppStore.getState().training.scenarioActive;
        state.setTraining({
          isTraining: false,
          progress: 100,
          message: best
            ? `Сравнение сохранённых моделей готово. Лучшая: ${best.modelType} (${(best.universalScore * 100).toFixed(1)}%)${
                failed.length ? `. Не удалось загрузить: ${failed.join(", ")}` : ""
              }`
            : "Сравнение сохранённых моделей готово",
          coachMood: duringCompare ? "working" : "success"
        });
        if (!fromEvent) {
          await runEventChain("trained");
        }
        continue;
      }
      if (command.type === "train") {
        const fallbackType: ModelType = command.datasetRef.startsWith("tabular:")
          ? "tabular_regression"
          : "image_knn";
        const modelType = parseModelTypeRef(command.modelTypeRef, fallbackType);
        await trackEvent("training_started", { modelType });
        onMiniStudioActivity?.({
          type: "train",
          modelType,
          datasetRef: command.datasetRef
        });
        state.setLastModelType(modelType);
        state.setModelComparisonReport(null);
        loadedSavedModelIdRef.current = null;
        const [kind, id] = command.datasetRef.split(":");
        const imageDataset =
          kind === "image" ? state.imageDatasets.find((item) => item.id === id) : null;
        const tabularDataset =
          kind === "tabular"
            ? state.tabularDatasets.find((item) => item.id === id)?.dataset ?? null
            : null;
        if (modelType === "image_knn" && !imageDataset) {
          throw new Error("Для image модели выбери image dataset в блоке обучения.");
        }
        if (modelType !== "image_knn" && !tabularDataset) {
          throw new Error("Для tabular модели выбери tabular dataset в блоке обучения.");
        }
        state.setTraining({
          isTraining: true,
          progress: 0,
          message: `Запуск обучения: ${modelType}`,
          coachMood: "working"
        });
        const splitSum = command.trainSplit + command.valSplit + command.testSplit;
        if (Math.abs(splitSum - 1) > 0.02) {
          throw new Error("Сумма train/val/test должна быть около 1.0");
        }
        const trainOutcome = await trainByModelType({
          modelType,
          imageDataset: imageDataset ?? null,
          tabularDataset,
          config: {
            trainSplit: command.trainSplit,
            valSplit: command.valSplit,
            testSplit: command.testSplit,
            epochs: command.epochs,
            learningRate: command.learningRate
          },
          onProgress: (progress, message) => {
            state.setTraining({ progress, message, coachMood: "working" });
          }
        });
        lastEvaluationRef.current = trainOutcome.evaluation;
        state.setTrainingRunReport(trainOutcome.report);
        state.setEvaluation(trainOutcome.evaluation);
        const duringScenario = useAppStore.getState().training.scenarioActive;
        state.setTraining({
          isTraining: false,
          progress: 100,
          message: "",
          coachMood: duringScenario ? "working" : "success"
        });
        if (miniStudioToolbar) {
          queueMicrotask(() => window.dispatchEvent(new Event("nodly-persist-studio")));
        }
        await trackEvent("training_completed", {
          modelType,
          summary: trainOutcome.evaluation.summary
        });
        if (!fromEvent) {
          await runEventChain("trained");
        }
      }
      if (command.type === "save_model") {
        if (effectiveToolboxLevel(useAppStore.getState().workspaceLevel) === 1) {
          throw new Error("Сохранение модели в библиотеку доступно с уровня 2. Переключи уровень или убери блок «сохранить модель».");
        }
        const lastType = getLastTrainedModelType();
        if (lastType === "tabular_svm" || lastType === "tabular_random_forest") {
          throw new Error(
            "Сохранение SVM/Random Forest пока не поддерживается. Выбери tabular_classification / tabular_neural / tabular_regression."
          );
        }
        if (!canPersistCurrentModel()) {
          throw new Error("Нечего сохранить: сначала обучи модель (или загрузи сохранённую).");
        }
        const modelId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const { modelType } = await persistCurrentModelToLibrary(modelId);
        const title = command.title.trim() || "Модель";
        state.addSavedModel({
          id: modelId,
          title,
          modelType,
          createdAt: new Date().toISOString()
        });
        const duringSave = useAppStore.getState().training.scenarioActive;
        state.setTraining({
          isTraining: false,
          message: `Модель «${title}» (${modelType}) в библиотеке`,
          coachMood: duringSave ? "working" : "success"
        });
      }
      if (command.type === "wait") {
        await sleep(Math.max(0, command.seconds) * 1000);
      }
      if (command.type === "predict") {
        const useSessionModel = command.savedModelId === SESSION_TRAINED_MODEL_ID;
        let modelType: ModelType;
        if (useSessionModel) {
          if (!canPersistCurrentModel()) {
            throw new Error(
              "Сначала обучи модель или выбери сохранённую из библиотеки: для режима «после обучения» в памяти должна быть готовая модель."
            );
          }
          const t = getLastTrainedModelType();
          if (!t) {
            throw new Error("Нет типа модели в памяти. Сначала обучи модель.");
          }
          modelType = t;
          loadedSavedModelIdRef.current = SESSION_TRAINED_MODEL_ID;
        } else {
          const entry = state.savedModels.find((m) => m.id === command.savedModelId);
          if (!entry) {
            throw new Error("Сохранённая модель не найдена. Выбери модель из библиотеки в блоке «предсказать».");
          }
          if (loadedSavedModelIdRef.current !== entry.id) {
            await loadModelFromLibraryEntry(entry);
            loadedSavedModelIdRef.current = entry.id;
          }
          modelType = entry.modelType;
        }
        state.setLastModelType(modelType);
        const labelsMap = state.imageDatasets
          .flatMap((dataset) => dataset.classes)
          .reduce<Record<string, string>>((acc, item) => {
            acc[item.labelId] = item.title;
            return acc;
          }, {});

        if (modelType === "image_knn") {
          const [kind, id] = command.inputRef.split(":");
          const imageInput =
            kind === "image" ? state.imagePredictionInputs.find((item) => item.id === id) : null;
          if (!imageInput) {
            throw new Error("Для картинок выбери файл из библиотеки во входе «Image: …».");
          }
          const result = await predictByModelType({
            modelType: "image_knn",
            predictionFile: imageInput.file,
            labelsMap,
            tabularInput: ""
          });
          state.setPrediction(result);
          const duringPredImg = useAppStore.getState().training.scenarioActive;
          state.setTraining({
            isTraining: false,
            message: "",
            coachMood: duringPredImg ? "working" : "success"
          });
          if (miniStudioToolbar) {
            queueMicrotask(() => window.dispatchEvent(new Event("nodly-persist-studio")));
          }
          await trackEvent("prediction_run", {
            modelType,
            label: result?.title ?? null
          });
          onMiniStudioActivity?.({
            type: "predict",
            modelType,
            inputRef: command.inputRef,
            label: result?.title ?? null
          });
          if (!fromEvent) {
            await runEventChain("predicted");
          }
        } else {
          const ref = command.inputRef;
          let tabularLine = "";
          if (ref === TABULAR_MANUAL_REF || ref === "none") {
            tabularLine = command.inlineTabular.trim();
          } else if (ref.startsWith("tabular:")) {
            const sid = ref.slice("tabular:".length);
            tabularLine =
              state.tabularPredictionInputs.find((item) => item.id === sid)?.input.trim() ?? "";
          }
          if (!tabularLine) {
            throw new Error(
              "Для таблиц: либо выбери строку из библиотеки во «вход», либо «Вручную» и заполни признаки через запятую."
            );
          }
          const result = await predictByModelType({
            modelType,
            predictionFile: null,
            labelsMap,
            tabularInput: tabularLine
          });
          state.setPrediction(result);
          const duringPredTab = useAppStore.getState().training.scenarioActive;
          state.setTraining({
            isTraining: false,
            message: "",
            coachMood: duringPredTab ? "working" : "success"
          });
          if (miniStudioToolbar) {
            queueMicrotask(() => window.dispatchEvent(new Event("nodly-persist-studio")));
          }
          await trackEvent("prediction_run", {
            modelType,
            label: result?.title ?? null
          });
          onMiniStudioActivity?.({
            type: "predict",
            modelType,
            inputRef: command.inputRef,
            label: result?.title ?? null
          });
          if (!fromEvent) {
            await runEventChain("predicted");
          }
        }
      }
      if (command.type === "show_message") {
        const scriptText = command.text.trim();
        state.setCoachUserMessage(scriptText.length > 0 ? scriptText : null);
        state.setTraining({
          isTraining: false,
          message: "",
          coachMood: "working"
        });
      }
      if (command.type === "show_result") {
        // Ничего не показываем в большой плашке сцены:
        // результат уже доступен в состоянии prediction для условий и логики блоков.
      }
      if (command.type === "add_journal") {
        const line = command.text.trim();
        if (line) {
          journal.push(line);
          state.setTraining({ isTraining: false, message: `Журнал: ${journal.join(" | ")}`, coachMood: "working" });
        }
      }
      if (command.type === "show_eval") {
        const evalToShow = lastEvaluationRef.current ?? useAppStore.getState().evaluation;
        if (evalToShow) {
          state.setEvaluation(evalToShow);
          state.setTraining({ isTraining: false, message: "", coachMood: "working" });
        } else {
          throw new Error("Оценка модели появится после обучения/тестирования");
        }
      }
    }
  };

  const runProgram = async () => {
    if (isRunningRef.current) {
      return;
    }
    isRunningRef.current = true;
    try {
      const state = useAppStore.getState();
      lastEvaluationRef.current = state.evaluation;
      state.setCoachUserMessage(null);
      const workspace = workspaceRef.current;
      if (!workspace) {
        return;
      }
      const startHats = sortBlocklyHatsByWorkspaceOrder(
        workspace.getTopBlocks(true).filter((block) => block.type === "noda_start" && block.isEnabled())
      );
      if (startHats.length === 0) {
        state.setTraining({
          isTraining: false,
          scenarioActive: false,
          message: "Добавь блок «Старт» и присоединяй к нему цепочку команд.",
          coachMood: "error"
        });
        return;
      }
      const chains = startHats
        .map((hat) => parseCommandChain(hat.getNextBlock()))
        .filter((chain) => chain.length > 0);
      if (chains.length === 0) {
        state.setTraining({
          isTraining: false,
          scenarioActive: false,
          message: "Подключи к «Старт» хотя бы один блок (обучение, предсказание и т.д.).",
          coachMood: "error"
        });
        return;
      }
      useAppStore.getState().setTraining({
        isTraining: false,
        scenarioActive: true,
        coachMood: "working",
        message: "",
        progress: 0
      });
      for (const commands of chains) {
        await executeCommands(commands);
      }
      useAppStore.getState().setTraining({
        isTraining: false,
        scenarioActive: false,
        message: "",
        coachMood: "success",
        progress: 100
      });
    } catch (error) {
      useAppStore.getState().setTraining({
        isTraining: false,
        scenarioActive: false,
        message: error instanceof Error ? error.message : "Ошибка выполнения сценария",
        coachMood: "error"
      });
    } finally {
      isRunningRef.current = false;
      const fin = useAppStore.getState();
      if (fin.training.scenarioActive) {
        fin.setTraining({ scenarioActive: false });
      }
    }
  };

  useEffect(() => {
    registerBlocks();
    if (!containerRef.current) {
      return;
    }
    const initialDark = document.documentElement.getAttribute("data-theme") === "dark";
    /** Нейтральная сетка; stroke не пересчитывается при смене темы — средний тон для light/dark. */
    const gridDotColour = "#a8b0c4";
    workspaceRef.current = Blockly.inject(containerRef.current, {
      trashcan: true,
      theme: initialDark ? NODLY_BLOCKLY_DARK : NODLY_BLOCKLY_LIGHT,
      grid: {
        spacing: 20,
        length: 3,
        colour: gridDotColour,
        snap: false
      },
      move: {
        scrollbars: true,
        drag: true,
        wheel: false
      },
      zoom: {
        controls: true,
        wheel: true,
        pinch: true,
        startScale: 1,
        maxScale: 3,
        minScale: 0.3,
        scaleSpeed: 1.06
      }
    });
    const level = useAppStore.getState().workspaceLevel;
    const effLevel = effectiveToolboxLevel(level);
    const trainType = effLevel === 1 ? "noda_train_model_simple" : "noda_train_model";
    const initialState =
      blocklyState.trim().length > 0
        ? JSON.parse(blocklyState)
        : getDefaultWorkspaceJson(trainType);
    Blockly.serialization.workspaces.load(initialState, workspaceRef.current);
    clampBlocksToViewport(workspaceRef.current);
    refreshAllPredictL1Blocks(workspaceRef.current);
    const clickHandler = (event: Blockly.Events.Abstract) => {
      if (!workspaceRef.current) {
        return;
      }
      const selectedBlockId =
        (event as unknown as { blockId?: string }).blockId ??
        (event as unknown as { newElementId?: string }).newElementId;
      if (!selectedBlockId) {
        return;
      }
      const block = workspaceRef.current.getBlockById(selectedBlockId);
      if (!block) {
        return;
      }
      const isClickType =
        event.type === Blockly.Events.CLICK || event.type === Blockly.Events.SELECTED;
      if (isClickType && block.type === "noda_start") {
        void runProgram();
      }
    };
    const persistHandler = () => {
      if (!workspaceRef.current) {
        return;
      }
      const saved = Blockly.serialization.workspaces.save(workspaceRef.current);
      useAppStore.getState().setBlocklyState(JSON.stringify(saved));
      if (miniToolbarRef.current) {
        const w = window as Window & { __nodlyMiniFlushTimer?: number };
        if (w.__nodlyMiniFlushTimer) {
          window.clearTimeout(w.__nodlyMiniFlushTimer);
        }
        w.__nodlyMiniFlushTimer = window.setTimeout(() => {
          w.__nodlyMiniFlushTimer = undefined;
          window.dispatchEvent(new Event("nodly-persist-studio"));
        }, 450);
      }
    };
    (window as Window & { __nodlyGetBlocklyState?: () => string }).__nodlyGetBlocklyState = () => {
      if (!workspaceRef.current) {
        return "";
      }
      return JSON.stringify(Blockly.serialization.workspaces.save(workspaceRef.current));
    };
    const boundsHandler = (event: Blockly.Events.Abstract) => {
      if (!workspaceRef.current) {
        return;
      }
      if (event.type === Blockly.Events.BLOCK_MOVE) {
        clampBlocksToViewport(workspaceRef.current);
      }
    };
    const predictL1SyncHandler = (event: Blockly.Events.Abstract) => {
      const ws = workspaceRef.current;
      if (!ws) {
        return;
      }
      let need = false;
      if (
        event.type === Blockly.Events.BLOCK_MOVE ||
        event.type === Blockly.Events.BLOCK_CREATE ||
        event.type === Blockly.Events.BLOCK_DELETE
      ) {
        need = true;
      } else if (event.type === Blockly.Events.BLOCK_CHANGE) {
        const bid = (event as Blockly.Events.BlockChange).blockId;
        if (bid) {
          const b = ws.getBlockById(bid);
          if (b) {
            const t = b.type;
            need =
              t === "noda_predict_l1" ||
              t === "noda_train_model_simple" ||
              t === "noda_train_model";
          }
        }
      }
      if (need) {
        refreshAllPredictL1Blocks(ws);
      }
    };
    workspaceRef.current.addChangeListener(clickHandler);
    workspaceRef.current.addChangeListener(persistHandler);
    workspaceRef.current.addChangeListener(boundsHandler);
    workspaceRef.current.addChangeListener(predictL1SyncHandler);
    const resizeHandler = () => {
      if (workspaceRef.current) {
        Blockly.svgResize(workspaceRef.current);
      }
    };
    window.addEventListener("resize", resizeHandler);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", resizeHandler);
      vv.addEventListener("scroll", resizeHandler);
    }
    resizeHandler();
    setPaletteColors(collectPaletteColors(workspaceRef.current, effLevel));
    return () => {
      workspaceRef.current?.removeChangeListener(clickHandler);
      workspaceRef.current?.removeChangeListener(persistHandler);
      workspaceRef.current?.removeChangeListener(boundsHandler);
      workspaceRef.current?.removeChangeListener(predictL1SyncHandler);
      window.removeEventListener("resize", resizeHandler);
      if (vv) {
        vv.removeEventListener("resize", resizeHandler);
        vv.removeEventListener("scroll", resizeHandler);
      }
      workspaceRef.current?.dispose();
      workspaceRef.current = null;
      delete (window as Window & { __nodlyGetBlocklyState?: () => string }).__nodlyGetBlocklyState;
    };
  }, []);

  useEffect(() => {
    const ws = workspaceRef.current;
    if (!ws) {
      return;
    }
    const isDark = htmlTheme === "dark";
    ws.setTheme(isDark ? NODLY_BLOCKLY_DARK : NODLY_BLOCKLY_LIGHT);
    Blockly.svgResize(ws);
  }, [htmlTheme]);

  useEffect(() => {
    const ws = workspaceRef.current;
    if (!ws) {
      return;
    }
    const level = effectiveToolboxLevel(useAppStore.getState().workspaceLevel);
    const trainType = level === 1 ? "noda_train_model_simple" : "noda_train_model";
    const defaultJson = getDefaultWorkspaceJson(trainType);
    const trimmed = blocklyState.trim();
    let toLoad: unknown = defaultJson;
    if (trimmed.length > 0) {
      try {
        toLoad = JSON.parse(blocklyState);
      } catch {
        toLoad = defaultJson;
      }
    }
    const currentJson = JSON.stringify(Blockly.serialization.workspaces.save(ws));
    const targetJson = JSON.stringify(toLoad);
    if (currentJson === targetJson) {
      return;
    }
    try {
      Blockly.serialization.workspaces.load(toLoad as object, ws);
      Blockly.svgResize(ws);
      refreshAllPredictL1Blocks(ws);
      const after = JSON.stringify(Blockly.serialization.workspaces.save(ws));
      if (after !== trimmed) {
        useAppStore.getState().setBlocklyState(after);
      }
    } catch {
      /* malformed or incompatible saved state */
    }
  }, [blocklyState, workspaceLevel]);

  return (
    <div className="blockly-root">
      <div className="blockly-root__toolbar">
        <Space size={8} wrap>
          {miniStudioToolbar ? (
            <>
              <Button
                type="default"
                size="small"
                icon={<DatabaseOutlined />}
                onClick={() => onOpenDataLibrary?.()}
              >
                Данные
              </Button>
              <Button
                type="primary"
                size="small"
                icon={<SaveOutlined />}
                onClick={() => onSaveProject?.()}
                disabled={!onSaveProject}
              >
                Сохранить в проекты
              </Button>
              <Button
                type="link"
                size="small"
                className="blockly-root__mini-tab"
                icon={<ExportOutlined />}
                href={
                  standaloneStudioHref ??
                  (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : undefined)
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                Во вкладке
              </Button>
            </>
          ) : (
            <>
              <Segmented<WorkspaceLevel>
                size="small"
                value={workspaceLevel}
                onChange={(v) => setWorkspaceLevel(v)}
                options={[
                  { label: "Уровень 1", value: 1 },
                  { label: "Уровень 2", value: 2 }
                ]}
              />
            </>
          )}
        </Space>
      </div>
      <div className="blockly-layout">
          <div className="blockly-palette">
            {(
              ["events", "data", "model", "predict", "evaluate", "control", "output"] as PaletteGroupIdExt[]
            )
              .map((group) => ({
                group,
                items: paletteItems.filter((item) => item.group === group)
              }))
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <div key={group.group} className="blockly-palette-group">
                  <div className="blockly-palette-group-title">
                    {PALETTE_GROUP_TITLES[group.group]}
                  </div>
                  {group.items.map((item) => {
                    const color = paletteColors[item.type];
                    const style = color
                      ? { backgroundColor: color, color: "#fff", borderColor: "transparent" }
                      : undefined;
                    return (
                      <Button
                        key={item.type}
                        size="small"
                        block
                        className={`blockly-palette-btn blockly-palette-btn--${item.shape ?? "stack"}`}
                        style={style}
                        title={item.description}
                        onClick={() => spawnBlock(item.type)}
                      >
                        {item.title}
                      </Button>
                    );
                  })}
                </div>
              ))}
          </div>
          <div className="blockly-workspace-surface">
            <div ref={containerRef} className="blockly-container" />
            {miniStudioToolbar && miniCoachGoals ? (
              <MiniWorkspaceGoalsOverlay
                goals={miniCoachGoals.goals}
                goalStatus={miniCoachGoals.goalStatus}
                allGoalsDone={miniCoachGoals.allGoalsDone}
              />
            ) : null}
          </div>
      </div>
    </div>
  );
}
