import { useEffect, useRef, useState } from "react";
import { DatabaseOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Segmented, Space, Tag, Tooltip } from "antd";
import * as Blockly from "blockly";
import { useAppStore } from "@/store/useAppStore";
import type { WorkspaceLevel } from "@/store/useAppStore";
import {
  canPersistCurrentModel,
  loadModelFromLibraryEntry,
  persistCurrentModelToLibrary,
  predictByModelType,
  trainByModelType
} from "@/features/model/mlEngine";
import type { ModelEvaluation, ModelType, SavedModelEntry } from "@/shared/types/ai";
import { trackEvent } from "@/features/analytics/analytics";
import { useHtmlDataTheme } from "@/hooks/useHtmlDataTheme";

const NODLY_BLOCKLY_DARK = Blockly.Theme.defineTheme("nodly_dark", {
  name: "nodly_dark",
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: "#1e293b",
    toolboxBackgroundColour: "#111827",
    toolboxForegroundColour: "#e5e7eb",
    flyoutBackgroundColour: "#1e293b",
    flyoutForegroundColour: "#cbd5e1",
    scrollbarColour: "#64748b",
    insertionMarkerColour: "#60a5fa"
  }
});

const BLOCK_COLOR = {
  events: 20,
  model: 220,
  modelTypes: 200,
  predict: 160,
  control: 45,
  data: 260,
  output: 290
} as const;

const DEFAULT_TRAIN_CONFIG = {
  trainSplit: 0.7,
  valSplit: 0.15,
  testSplit: 0.15,
  epochs: 80,
  learningRate: 0.02
} as const;

type BlockCommand =
  | { type: "start" }
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

function parseModelTypeRef(ref: string): ModelType {
  if (
    ref === "image_knn" ||
    ref === "tabular_regression" ||
    ref === "tabular_classification" ||
    ref === "tabular_neural"
  ) {
    return ref;
  }
  return "image_knn";
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

function getSavedModelBlocklyOptions(): [string, string][] {
  const models = useAppStore.getState().savedModels;
  if (models.length === 0) {
    return [["нет сохранённых моделей", "__none__"]];
  }
  return models.map((m) => [`${m.title} (${m.modelType})`, m.id]);
}

function getSavedModelEntryById(id: string): SavedModelEntry | null {
  if (!id || id === "__none__") {
    return null;
  }
  return useAppStore.getState().savedModels.find((m) => m.id === id) ?? null;
}

function getPredictInputOptions(savedModelId: string): [string, string][] {
  const model = getSavedModelEntryById(savedModelId);
  if (!model) {
    return [["сначала выбери модель", "none"]];
  }
  const state = useAppStore.getState();
  if (isImageModel(model.modelType)) {
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

/** Уровень 3 пока как 2 — только набор блоков в палитре */
function effectiveToolboxLevel(level: WorkspaceLevel): 1 | 2 {
  return level === 1 ? 1 : 2;
}

type PaletteGroupId = "events" | "data" | "model" | "predict" | "model_types";
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
  model_types: "Типы моделей",
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
        description: "Запускает основной сценарий проекта"
      },
      { type: "noda_train_model_simple", title: "Обучить модель", group: "model", shape: "stack" },
      { type: "noda_model_image_knn", title: "Модель: картинки (KNN)", group: "model_types", shape: "value" },
      {
        type: "noda_model_tabular_regression",
        title: "Модель: регрессия",
        group: "model_types",
        shape: "value"
      },
      {
        type: "noda_model_tabular_classification",
        title: "Модель: классификация",
        group: "model_types",
        shape: "value"
      },
      { type: "noda_model_tabular_neural", title: "Модель: нейросеть", group: "model_types", shape: "value" },
      { type: "noda_predict_class", title: "Предсказать", group: "predict", shape: "stack" },
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
      description: "Запускает основной сценарий проекта"
    },
    {
      type: "noda_on_trained",
      title: "когда модель обучена",
      group: "events",
      shape: "hat",
      description: "Срабатывает после успешного обучения модели"
    },
    {
      type: "noda_on_predicted",
      title: "когда получено предсказание",
      group: "events",
      shape: "hat",
      description: "Срабатывает после команды предсказать"
    },
    { type: "noda_train_model", title: "Обучить модель", group: "model", shape: "stack" },
    { type: "noda_model_image_knn", title: "Модель: картинки (KNN)", group: "model_types", shape: "value" },
    {
      type: "noda_model_tabular_regression",
      title: "Модель: регрессия",
      group: "model_types",
      shape: "value"
    },
    {
      type: "noda_model_tabular_classification",
      title: "Модель: классификация",
      group: "model_types",
      shape: "value"
    },
    { type: "noda_model_tabular_neural", title: "Модель: нейросеть", group: "model_types", shape: "value" },
    {
      type: "noda_show_eval",
      title: "Показать оценку модели",
      group: "model",
      shape: "stack",
      description:
        "Показывает метрики последнего обучения (после «Обучить модель»). Для регрессии: MSE, MAE, RMSE; для классификации: точность и loss."
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
  const model = getSavedModelEntryById(block.getFieldValue("SAVED_MODEL_ID"));
  const ref = block.getFieldValue("INPUT_REF");
  const manual = ref === TABULAR_MANUAL_REF || ref === "none";
  const show = !!model && model.modelType !== "image_knn" && manual;
  block.getInput("INLINE_ROW")?.setVisible(show);
  const svg = block as Blockly.BlockSvg;
  if (svg.rendered) {
    svg.render();
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
  /** Уровень 1: только модель и датасет */
  Blockly.Blocks.noda_train_model_simple = {
    init() {
      this.appendValueInput("MODEL")
        .setCheck("ModelType")
        .appendField("обучить модель")
        .appendField("данные")
        .appendField(
          new Blockly.FieldDropdown(function () {
            const source = this.getSourceBlock();
            const modelBlock = source?.getInputTargetBlock("MODEL");
            const modelType = parseModelTypeRef(
              String(modelBlock?.getFieldValue("MODEL_TYPE_REF") ?? source?.getFieldValue("MODEL_TYPE") ?? "image_knn")
            );
            return getTrainDatasetOptions(modelType);
          }),
          "DATASET_REF"
        );
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.model);
    }
  };
  /** Уровень 2+: сплит, эпохи, lr */
  Blockly.Blocks.noda_train_model = {
    init() {
      this.appendValueInput("MODEL")
        .setCheck("ModelType")
        .appendField("обучить модель")
        .appendField("данные")
        .appendField(
          new Blockly.FieldDropdown(function () {
            const source = this.getSourceBlock();
            const modelBlock = source?.getInputTargetBlock("MODEL");
            const modelType = parseModelTypeRef(
              String(modelBlock?.getFieldValue("MODEL_TYPE_REF") ?? source?.getFieldValue("MODEL_TYPE") ?? "image_knn")
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
        .appendField(new Blockly.FieldNumber(0.02, 0.0001, 1, 0.001), "LR");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(BLOCK_COLOR.model);
    }
  };
  Blockly.Blocks.noda_model_image_knn = {
    init() {
      this.appendDummyInput()
        .appendField("картинки (KNN)")
        .appendField(new Blockly.FieldDropdown([["image_knn", "image_knn"]]), "MODEL_TYPE_REF");
      this.setOutput(true, "ModelType");
      this.setColour(BLOCK_COLOR.modelTypes);
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
      this.setColour(120);
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
    blocks.push({ type: "noda_predict_class", x: 20, y: 180 });
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
  onOpenDataLibrary?: () => void;
};

export function BlocklyWorkspace({ miniStudioToolbar, onOpenDataLibrary }: BlocklyWorkspaceProps = {}) {
  const htmlTheme = useHtmlDataTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const isRunningRef = useRef(false);
  const { prediction, evaluation, blocklyState, workspaceLevel, setWorkspaceLevel } = useAppStore();

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
    const DELETE_X = 0;
    const MIN_X = 16;
    const MIN_Y = -Infinity;
    for (const block of blocks) {
      const xy = block.getRelativeToSurfaceXY();
      if (xy.x < DELETE_X) {
        block.dispose(false);
        continue;
      }
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
        const modelTypeRef = String(
          current.getInputTargetBlock("MODEL")?.getFieldValue("MODEL_TYPE_REF") ??
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
        const modelTypeRef = String(
          current.getInputTargetBlock("MODEL")?.getFieldValue("MODEL_TYPE_REF") ??
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
          learningRate: Number(current.getFieldValue("LR")) || 0.02
        });
      } else if (current.type === "noda_save_model") {
        commands.push({
          type: "save_model",
          title: String(current.getFieldValue("SAVE_TITLE") ?? "")
        });
      } else if (current.type === "noda_predict_class") {
        const savedModelId = String(current.getFieldValue("SAVED_MODEL_ID") ?? "");
        if (!savedModelId || savedModelId === "__none__") {
          current = current.getNextBlock();
          continue;
        }
        commands.push({
          type: "predict",
          savedModelId,
          inputRef: current.getFieldValue("INPUT_REF"),
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

  const readCommandsFromHat = (hatType: string): BlockCommand[] => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return [];
    }
    const hatBlock = workspace.getTopBlocks(true).find((block) => block.type === hatType);
    if (!hatBlock) {
      return [];
    }
    return [{ type: "start" }, ...parseCommandChain(hatBlock.getNextBlock())];
  };

  const readCommandsFromStart = (): BlockCommand[] => readCommandsFromHat("noda_start");

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
    const commands = readCommandsFromHat(hatType);
    if (commands.length === 0) {
      return;
    }
    await executeCommands(commands, { fromEvent: true });
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
      if (command.type === "train") {
        const modelType = parseModelTypeRef(command.modelTypeRef);
        await trackEvent("training_started", { modelType });
        state.setLastModelType(modelType);
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
          message: `Запуск обучения: ${modelType}`
        });
        const splitSum = command.trainSplit + command.valSplit + command.testSplit;
        if (Math.abs(splitSum - 1) > 0.02) {
          throw new Error("Сумма train/val/test должна быть около 1.0");
        }
        const evalResult = await trainByModelType({
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
            state.setTraining({ progress, message });
          }
        });
        lastEvaluationRef.current = evalResult;
        state.setTraining({ isTraining: false, progress: 100, message: "Обучение завершено." });
        await trackEvent("training_completed", {
          modelType,
          summary: evalResult.summary
        });
        if (!fromEvent) {
          await runEventChain("trained");
        }
      }
      if (command.type === "save_model") {
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
        state.setTraining({
          isTraining: false,
          message: `Модель «${title}» (${modelType}) в библиотеке`
        });
      }
      if (command.type === "wait") {
        await sleep(Math.max(0, command.seconds) * 1000);
      }
      if (command.type === "predict") {
        const entry = state.savedModels.find((m) => m.id === command.savedModelId);
        if (!entry) {
          throw new Error("Сохранённая модель не найдена. Выбери модель из библиотеки в блоке «предсказать».");
        }
        if (loadedSavedModelIdRef.current !== entry.id) {
          await loadModelFromLibraryEntry(entry);
          loadedSavedModelIdRef.current = entry.id;
        }
        state.setLastModelType(entry.modelType);
        const labelsMap = state.imageDatasets
          .flatMap((dataset) => dataset.classes)
          .reduce<Record<string, string>>((acc, item) => {
            acc[item.labelId] = item.title;
            return acc;
          }, {});

        if (entry.modelType === "image_knn") {
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
          await trackEvent("prediction_run", {
            modelType: entry.modelType,
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
            modelType: entry.modelType,
            predictionFile: null,
            labelsMap,
            tabularInput: tabularLine
          });
          state.setPrediction(result);
          await trackEvent("prediction_run", {
            modelType: entry.modelType,
            label: result?.title ?? null
          });
          if (!fromEvent) {
            await runEventChain("predicted");
          }
        }
      }
      if (command.type === "show_message") {
        state.setTraining({
          isTraining: false,
          message: command.text.trim() || "Сообщение из сценария"
        });
      }
      if (command.type === "show_result") {
        if (state.prediction) {
          state.setTraining({
            isTraining: false,
            message: `Результат: ${state.prediction.title} (${(state.prediction.confidence * 100).toFixed(1)}%)`
          });
        } else {
          state.setTraining({ isTraining: false, message: "Результат ещё не получен" });
        }
      }
      if (command.type === "add_journal") {
        const line = command.text.trim();
        if (line) {
          journal.push(line);
          state.setTraining({ isTraining: false, message: `Журнал: ${journal.join(" | ")}` });
        }
      }
      if (command.type === "show_eval") {
        if (lastEvaluationRef.current) {
          state.setEvaluation(lastEvaluationRef.current);
          state.setTraining({ isTraining: false, message: `Оценка: ${lastEvaluationRef.current.summary}` });
        } else {
          state.setTraining({
            isTraining: false,
            message: "Оценка модели появится после обучения/тестирования"
          });
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
      lastEvaluationRef.current = null;
      state.setEvaluation(null);
      const commands = readCommandsFromStart();
      if (commands.length === 0) {
        state.setTraining({
          isTraining: false,
          message: "Добавь блок Старт и соедини с ним блоки обучения/предсказания."
        });
        return;
      }
      await executeCommands(commands);
    } catch (error) {
      useAppStore.getState().setTraining({
        isTraining: false,
        message: error instanceof Error ? error.message : "Ошибка выполнения сценария"
      });
    } finally {
      isRunningRef.current = false;
    }
  };

  useEffect(() => {
    registerBlocks();
    if (!containerRef.current) {
      return;
    }
    const initialDark = document.documentElement.getAttribute("data-theme") === "dark";
    /** Один нейтральный цвет сетки: при смене темы Blockly обновляет только theme, не stroke сетки. */
    const gridDotColour = "#949494";
    workspaceRef.current = Blockly.inject(containerRef.current, {
      trashcan: true,
      theme: initialDark ? NODLY_BLOCKLY_DARK : Blockly.Themes.Classic,
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
    };
    const boundsHandler = (event: Blockly.Events.Abstract) => {
      if (!workspaceRef.current) {
        return;
      }
      if (event.type === Blockly.Events.BLOCK_MOVE) {
        clampBlocksToViewport(workspaceRef.current);
      }
    };
    workspaceRef.current.addChangeListener(clickHandler);
    workspaceRef.current.addChangeListener(persistHandler);
    workspaceRef.current.addChangeListener(boundsHandler);
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
      window.removeEventListener("resize", resizeHandler);
      if (vv) {
        vv.removeEventListener("resize", resizeHandler);
        vv.removeEventListener("scroll", resizeHandler);
      }
      workspaceRef.current?.dispose();
      workspaceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ws = workspaceRef.current;
    if (!ws) {
      return;
    }
    const isDark = htmlTheme === "dark";
    ws.setTheme(isDark ? NODLY_BLOCKLY_DARK : Blockly.Themes.Classic);
    Blockly.svgResize(ws);
  }, [htmlTheme]);

  useEffect(() => {
    if (!workspaceRef.current || !blocklyState) {
      return;
    }
    const saved = Blockly.serialization.workspaces.save(workspaceRef.current);
    const current = JSON.stringify(saved);
    if (current === blocklyState) {
      return;
    }
    try {
      Blockly.serialization.workspaces.load(JSON.parse(blocklyState), workspaceRef.current);
      Blockly.svgResize(workspaceRef.current);
    } catch {
      // Ignore malformed saved state.
    }
  }, [blocklyState]);

  const showPredictHint = effectiveToolboxLevel(workspaceLevel) === 2;

  return (
    <div className="blockly-root">
      <div className="blockly-root__toolbar">
        <Tooltip
          title={
            <div>
              <div>
                Цепочка выполняется от блока <strong>Старт</strong>. Нажми на «Старт», чтобы запустить.
              </div>
              {showPredictHint ? (
                <div style={{ marginTop: 8 }}>
                  Уровень 2: в «Предсказать» укажи числа через запятую (как столбцы CSV) или выбери вход в
                  разделе «Данные». Для картинок KNN поле таблицы не нужно.
                </div>
              ) : null}
            </div>
          }
        >
          <Button type="text" size="small" icon={<QuestionCircleOutlined />} aria-label="Как запускать сценарий" />
        </Tooltip>
        <Space size={8} wrap>
          {miniStudioToolbar ? (
            <Button
              type="default"
              size="small"
              icon={<DatabaseOutlined />}
              onClick={() => onOpenDataLibrary?.()}
            >
              Данные
            </Button>
          ) : (
            <>
              {workspaceLevel === 3 ? <Tag color="processing">Скоро больше блоков</Tag> : null}
              <Segmented<WorkspaceLevel>
                size="small"
                value={workspaceLevel}
                onChange={(v) => setWorkspaceLevel(v)}
                options={[
                  { label: "Уровень 1", value: 1 },
                  { label: "Уровень 2", value: 2 },
                  { label: "Уровень 3", value: 3 }
                ]}
              />
            </>
          )}
        </Space>
      </div>
      <div className="blockly-layout">
          <div className="blockly-palette">
            {(
              ["events", "model_types", "data", "model", "predict", "evaluate", "control", "output"] as PaletteGroupIdExt[]
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
          <div ref={containerRef} className="blockly-container" />
      </div>
      <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 8, flexShrink: 0 }}>
        {prediction ? (
          <Alert
            type="success"
            showIcon
            message={`Результат: ${prediction.title}`}
            description={`Уверенность: ${(prediction.confidence * 100).toFixed(1)}%`}
          />
        ) : null}
        {evaluation ? (
          <Alert
            type="warning"
            showIcon
            message="Оценка модели"
            description={`${evaluation.summary}. ${Object.entries(evaluation.metrics)
              .map(([key, value]) => `${key}: ${value.toFixed(4)}`)
              .join(", ")}`}
          />
        ) : null}
      </Space>
    </div>
  );
}
