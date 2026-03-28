import { useEffect, useRef } from "react";
import { Alert, Card, Space, Typography } from "antd";
import * as Blockly from "blockly";
import { useAppStore } from "@/store/useAppStore";
import { predictByModelType, trainByModelType } from "@/features/model/mlEngine";
import type { ModelType } from "@/shared/types/ai";

const { Paragraph } = Typography;

type BlockCommand =
  | { type: "start" }
  | { type: "train"; modelType: ModelType; datasetRef: string }
  | { type: "predict"; modelType: ModelType; inputRef: string };

function isImageModel(modelType: ModelType) {
  return modelType === "image_knn";
}

function getTrainDatasetOptions(modelType: ModelType) {
  const state = useAppStore.getState();
  const merged = isImageModel(modelType)
    ? state.imageDatasets.map((item) => [`Image: ${item.title}`, `image:${item.id}`] as [string, string])
    : state.tabularDatasets.map(
        (item) => [`Tabular: ${item.title}`, `tabular:${item.id}`] as [string, string]
      );
  return merged.length > 0 ? merged : ([["нет данных", "none"]] as [string, string][]);
}

function getPredictInputOptions(modelType: ModelType) {
  const state = useAppStore.getState();
  const merged = isImageModel(modelType)
    ? state.imagePredictionInputs.map(
        (item) => [`Image input: ${item.title}`, `image:${item.id}`] as [string, string]
      )
    : state.tabularPredictionInputs.map(
        (item) => [`Tabular input: ${item.title}`, `tabular:${item.id}`] as [string, string]
      );
  return merged.length > 0
    ? merged
    : ([["нет входных данных", "none"]] as [string, string][]);
}

function registerBlocks() {
  if (Blockly.Blocks.noda_start) {
    return;
  }
  Blockly.Blocks.noda_start = {
    init() {
      this.appendDummyInput().appendField("Старт");
      this.setNextStatement(true, null);
      this.setColour(20);
      this.setDeletable(false);
      this.setMovable(false);
    }
  };
  Blockly.Blocks.noda_train_model = {
    init() {
      this.appendDummyInput()
        .appendField("обучить модель")
        .appendField(
          new Blockly.FieldDropdown([
            ["Image KNN (картинки)", "image_knn"],
            ["Регрессия (linear)", "tabular_regression"],
            ["Классификация (логистическая)", "tabular_classification"],
            ["Нейросеть (MLP)", "tabular_neural"]
          ]),
          "MODEL_TYPE"
        )
        .appendField("данные")
        .appendField(
          new Blockly.FieldDropdown(function () {
            const modelType = this.getSourceBlock()?.getFieldValue("MODEL_TYPE") as ModelType;
            return getTrainDatasetOptions(modelType);
          }),
          "DATASET_REF"
        );
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(220);
    }
  };
  Blockly.Blocks.noda_predict_class = {
    init() {
      this.appendDummyInput()
        .appendField("предсказать")
        .appendField(
          new Blockly.FieldDropdown([
            ["Image KNN (картинки)", "image_knn"],
            ["Регрессия (linear)", "tabular_regression"],
            ["Классификация (логистическая)", "tabular_classification"],
            ["Нейросеть (MLP)", "tabular_neural"]
          ]),
          "MODEL_TYPE"
        )
        .appendField("вход")
        .appendField(
          new Blockly.FieldDropdown(function () {
            const modelType = this.getSourceBlock()?.getFieldValue("MODEL_TYPE") as ModelType;
            return getPredictInputOptions(modelType);
          }),
          "INPUT_REF"
        );
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(160);
    }
  };
}

export function BlocklyWorkspace() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const isRunningRef = useRef(false);
  const { prediction, training, blocklyState } = useAppStore();

  const readCommandsFromStart = (): BlockCommand[] => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return [];
    }
    const startBlock = workspace.getTopBlocks(true).find((block) => block.type === "noda_start");
    if (!startBlock) {
      return [];
    }
    const commands: BlockCommand[] = [{ type: "start" }];
    let current = startBlock.getNextBlock();
    while (current) {
      if (current.type === "noda_train_model") {
        commands.push({
          type: "train",
          modelType: current.getFieldValue("MODEL_TYPE") as ModelType,
          datasetRef: current.getFieldValue("DATASET_REF")
        });
      }
      if (current.type === "noda_predict_class") {
        commands.push({
          type: "predict",
          modelType: current.getFieldValue("MODEL_TYPE") as ModelType,
          inputRef: current.getFieldValue("INPUT_REF")
        });
      }
      current = current.getNextBlock();
    }
    return commands;
  };

  const runProgram = async () => {
    if (isRunningRef.current) {
      return;
    }
    isRunningRef.current = true;
    try {
      const state = useAppStore.getState();
      const commands = readCommandsFromStart();
      if (commands.length === 0) {
        state.setTraining({
          isTraining: false,
          message: "Добавь блок Старт и соедини с ним блоки обучения/предсказания."
        });
        return;
      }

      for (const command of commands) {
        if (command.type === "train") {
          state.setLastModelType(command.modelType);
          const [kind, id] = command.datasetRef.split(":");
          const imageDataset =
            kind === "image" ? state.imageDatasets.find((item) => item.id === id) : null;
          const tabularDataset =
            kind === "tabular"
              ? state.tabularDatasets.find((item) => item.id === id)?.dataset ?? null
              : null;
          if (command.modelType === "image_knn" && !imageDataset) {
            throw new Error("Для image модели выбери image dataset в блоке обучения.");
          }
          if (command.modelType !== "image_knn" && !tabularDataset) {
            throw new Error("Для tabular модели выбери tabular dataset в блоке обучения.");
          }
          state.setTraining({
            isTraining: true,
            progress: 0,
            message: `Запуск обучения: ${command.modelType}`
          });
          await trainByModelType({
            modelType: command.modelType,
            classes: imageDataset?.classes ?? [],
            tabularDataset,
            onProgress: (progress, message) => {
              state.setTraining({ progress, message });
            }
          });
          state.setTraining({ isTraining: false, progress: 100, message: "Обучение завершено." });
        }
        if (command.type === "predict") {
          state.setLastModelType(command.modelType);
          const [kind, id] = command.inputRef.split(":");
          const imageInput =
            kind === "image" ? state.imagePredictionInputs.find((item) => item.id === id) : null;
          const tabularInput =
            kind === "tabular"
              ? state.tabularPredictionInputs.find((item) => item.id === id)?.input ?? ""
              : "";
          if (command.modelType === "image_knn" && !imageInput) {
            throw new Error("Для image предсказания выбери image input в блоке предсказания.");
          }
          if (command.modelType !== "image_knn" && !tabularInput) {
            throw new Error("Для tabular предсказания выбери tabular input в блоке предсказания.");
          }
          const labelsMap = state.imageDatasets
            .flatMap((dataset) => dataset.classes)
            .reduce<Record<string, string>>((acc, item) => {
              acc[item.labelId] = item.title;
              return acc;
            }, {});
          const result = await predictByModelType({
            modelType: command.modelType,
            predictionFile: imageInput?.file ?? null,
            labelsMap,
            tabularInput
          });
          state.setPrediction(result);
        }
      }
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
    workspaceRef.current = Blockly.inject(containerRef.current, {
      toolbox: {
        kind: "flyoutToolbox",
        contents: [
          { kind: "block", type: "noda_start" },
          { kind: "block", type: "noda_train_model" },
          { kind: "block", type: "noda_predict_class" }
        ]
      },
      trashcan: true
    });
    const initialState =
      blocklyState.trim().length > 0
        ? JSON.parse(blocklyState)
        : {
            blocks: {
              languageVersion: 0,
              blocks: [
                { type: "noda_start", x: 20, y: 20 },
                { type: "noda_train_model", x: 20, y: 100 },
                { type: "noda_predict_class", x: 20, y: 180 }
              ]
            }
          };
    Blockly.serialization.workspaces.load(initialState, workspaceRef.current);
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
    workspaceRef.current.addChangeListener(clickHandler);
    workspaceRef.current.addChangeListener(persistHandler);
    return () => {
      workspaceRef.current?.removeChangeListener(clickHandler);
      workspaceRef.current?.removeChangeListener(persistHandler);
      workspaceRef.current?.dispose();
      workspaceRef.current = null;
    };
  }, []);

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
    } catch {
      // Ignore malformed saved state.
    }
  }, [blocklyState]);

  return (
    <Card title="Blockly Workspace" size="small">
      <Paragraph>
        Выполняется только цепочка, подключенная к блоку Старт.
      </Paragraph>
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        <div ref={containerRef} className="blockly-container" />
        <Alert type="info" showIcon message={training.message} />
        {prediction ? (
          <Alert
            type="success"
            showIcon
            message={`Результат: ${prediction.title}`}
            description={`Уверенность: ${(prediction.confidence * 100).toFixed(1)}%`}
          />
        ) : null}
      </Space>
    </Card>
  );
}
