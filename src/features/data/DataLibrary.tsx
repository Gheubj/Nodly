import { useMemo, useState } from "react";
import { Alert, Button, Card, Divider, Input, Space, Tabs, Typography, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { useAppStore } from "@/store/useAppStore";
import { parseCsvFile } from "@/features/data/csv";

const { Paragraph, Text } = Typography;

export function DataLibrary() {
  const [newImageDatasetName, setNewImageDatasetName] = useState("");
  const [classNames, setClassNames] = useState<Record<string, string>>({});
  const [csvDatasetName, setCsvDatasetName] = useState("");
  const [imagePredictionName, setImagePredictionName] = useState("");
  const [tabularPredictionName, setTabularPredictionName] = useState("");
  const [tabularPredictionValue, setTabularPredictionValue] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);
  const {
    imageDatasets,
    tabularDatasets,
    imagePredictionInputs,
    tabularPredictionInputs,
    addImageDataset,
    addClassToImageDataset,
    addSamplesToClass,
    addTabularDataset,
    addImagePredictionInput,
    addTabularPredictionInput
  } = useAppStore();

  const canAddImageDataset = useMemo(
    () => newImageDatasetName.trim().length > 0,
    [newImageDatasetName]
  );

  return (
    <Card title="Библиотека данных" size="small">
      <Tabs
        defaultActiveKey="train"
        items={[
          {
            key: "train",
            label: "Данные для обучения",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Paragraph>Image dataset: создавай набор, классы и загружай изображения по классам.</Paragraph>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={newImageDatasetName}
                    onChange={(event) => setNewImageDatasetName(event.target.value)}
                    placeholder="Название image dataset, например RPS v1"
                  />
                  <Button
                    type="primary"
                    disabled={!canAddImageDataset}
                    onClick={() => {
                      addImageDataset(newImageDatasetName);
                      setNewImageDatasetName("");
                    }}
                  >
                    Создать
                  </Button>
                </Space.Compact>
                {imageDatasets.map((dataset) => (
                  <Card key={dataset.id} size="small" title={dataset.title}>
                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                      <Space.Compact style={{ width: "100%" }}>
                        <Input
                          value={classNames[dataset.id] ?? ""}
                          onChange={(event) =>
                            setClassNames((prev) => ({ ...prev, [dataset.id]: event.target.value }))
                          }
                          placeholder="Название класса (Камень, Ножницы...)"
                        />
                        <Button
                          onClick={() => {
                            addClassToImageDataset(dataset.id, classNames[dataset.id] ?? "");
                            setClassNames((prev) => ({ ...prev, [dataset.id]: "" }));
                          }}
                        >
                          Добавить класс
                        </Button>
                      </Space.Compact>
                      {dataset.classes.map((datasetClass) => {
                        const uploadProps: UploadProps = {
                          accept: "image/*",
                          multiple: true,
                          showUploadList: false,
                          beforeUpload: (file) => {
                            addSamplesToClass(dataset.id, datasetClass.labelId, [file]);
                            return false;
                          }
                        };
                        return (
                          <Card key={datasetClass.labelId} size="small">
                            <Text strong>{datasetClass.title}</Text>
                            <br />
                            <Text type="secondary">Снимков: {datasetClass.files.length}</Text>
                            <Divider style={{ margin: "8px 0" }} />
                            <Upload {...uploadProps}>
                              <Button block icon={<UploadOutlined />}>
                                Загрузить изображения
                              </Button>
                            </Upload>
                          </Card>
                        );
                      })}
                    </Space>
                  </Card>
                ))}

                <Divider style={{ margin: "8px 0" }} />
                <Paragraph>Табличные dataset (CSV): последняя колонка - целевая.</Paragraph>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={csvDatasetName}
                    onChange={(event) => setCsvDatasetName(event.target.value)}
                    placeholder="Название tabular dataset, например Students v1"
                  />
                  <Upload
                    accept=".csv,text/csv"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      void (async () => {
                        try {
                          const parsed = await parseCsvFile(file);
                          addTabularDataset(csvDatasetName || file.name, parsed);
                          setCsvDatasetName("");
                          setCsvError(null);
                        } catch (error) {
                          setCsvError(error instanceof Error ? error.message : "Не удалось прочитать CSV");
                        }
                      })();
                      return false;
                    }}
                  >
                    <Button icon={<UploadOutlined />}>Загрузить CSV</Button>
                  </Upload>
                </Space.Compact>
                {tabularDatasets.map((dataset) => (
                  <Card key={dataset.id} size="small">
                    <Text strong>{dataset.title}</Text>
                    <br />
                    <Text type="secondary">
                      Строк: {dataset.dataset.rows.length}, колонок: {dataset.dataset.headers.length}
                    </Text>
                  </Card>
                ))}
                {csvError ? <Alert type="error" showIcon message={csvError} /> : null}
              </Space>
            )
          },
          {
            key: "predict",
            label: "Данные для предсказания",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Paragraph>Подготовь входы для блока предсказания и выбирай их прямо в Blockly.</Paragraph>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={imagePredictionName}
                    onChange={(event) => setImagePredictionName(event.target.value)}
                    placeholder="Название image входа, например test_rock"
                  />
                  <Upload
                    accept="image/*"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      addImagePredictionInput(imagePredictionName || file.name, file);
                      setImagePredictionName("");
                      return false;
                    }}
                  >
                    <Button icon={<UploadOutlined />}>Добавить image</Button>
                  </Upload>
                </Space.Compact>
                {imagePredictionInputs.map((item) => (
                  <Card key={item.id} size="small">
                    <Text strong>{item.title}</Text>
                  </Card>
                ))}
                <Divider style={{ margin: "8px 0" }} />
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={tabularPredictionName}
                    onChange={(event) => setTabularPredictionName(event.target.value)}
                    placeholder="Название tabular входа, например student_a"
                  />
                  <Input
                    value={tabularPredictionValue}
                    onChange={(event) => setTabularPredictionValue(event.target.value)}
                    placeholder="Значения через запятую, например 6,7,1"
                  />
                  <Button
                    type="primary"
                    onClick={() => {
                      addTabularPredictionInput(tabularPredictionName || "tabular_input", tabularPredictionValue);
                      setTabularPredictionName("");
                      setTabularPredictionValue("");
                    }}
                  >
                    Добавить tabular
                  </Button>
                </Space.Compact>
                {tabularPredictionInputs.map((item) => (
                  <Card key={item.id} size="small">
                    <Text strong>{item.title}</Text>
                    <br />
                    <Text type="secondary">{item.input}</Text>
                  </Card>
                ))}
              </Space>
            )
          }
        ]}
      />
    </Card>
  );
}
