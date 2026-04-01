import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Divider,
  Input,
  Select,
  Space,
  Tabs,
  Typography,
  Upload,
  Modal,
  Image,
  List,
  message
} from "antd";
import {
  UploadOutlined,
  DeleteOutlined,
  EyeOutlined,
  DownloadOutlined,
  FileZipOutlined
} from "@ant-design/icons";
import type { UploadProps } from "antd";
import { useAppStore } from "@/store/useAppStore";
import { parseCsvFile } from "@/features/data/csv";
import { extractImageFilesFromZip } from "@/features/data/zipImages";
import { removeStoredModelFiles } from "@/features/model/mlEngine";
import type { SavedModelEntry } from "@/shared/types/ai";

const MODEL_TYPE_LABEL: Record<SavedModelEntry["modelType"], string> = {
  image_knn: "Картинки (KNN)",
  tabular_regression: "Таблица, регрессия",
  tabular_classification: "Таблица, классификация",
  tabular_neural: "Таблица, нейросеть"
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function filterImageSize(files: File[], onSkip: (name: string) => void): File[] {
  return files.filter((file) => {
    if (file.size > MAX_IMAGE_BYTES) {
      onSkip(file.name);
      return false;
    }
    return true;
  });
}

const { Paragraph, Text } = Typography;

export function DataLibrary() {
  const [newImageDatasetName, setNewImageDatasetName] = useState("");
  const [newImageDatasetTaskType, setNewImageDatasetTaskType] = useState<"classification" | "clustering">(
    "classification"
  );
  const [classNames, setClassNames] = useState<Record<string, string>>({});
  const [csvDatasetName, setCsvDatasetName] = useState("");
  const [imagePredictionName, setImagePredictionName] = useState("");
  const [tabularPredictionName, setTabularPredictionName] = useState("");
  const [tabularPredictionValue, setTabularPredictionValue] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const {
    imageDatasets,
    tabularDatasets,
    imagePredictionInputs,
    tabularPredictionInputs,
    addImageDataset,
    addClassToImageDataset,
    addSamplesToClass,
    addUnlabeledSamplesToImageDataset,
    clearUnlabeledSamples,
    addTabularDataset,
    addImagePredictionInput,
    addTabularPredictionInput,
    removeImageDataset,
    removeTabularDataset,
    removeImagePredictionInput,
    removeTabularPredictionInput,
    savedModels,
    removeSavedModel
  } = useAppStore();

  const filteredImageDatasets = useMemo(
    () => imageDatasets.filter((ds) => ds.title.toLowerCase().includes(searchQuery.toLowerCase())),
    [imageDatasets, searchQuery]
  );

  const filteredTabularDatasets = useMemo(
    () => tabularDatasets.filter((ds) => ds.title.toLowerCase().includes(searchQuery.toLowerCase())),
    [tabularDatasets, searchQuery]
  );

  const closePreview = () => {
    previewImages.forEach((url) => URL.revokeObjectURL(url));
    setPreviewImages([]);
    setPreviewVisible(false);
  };

  const trainTabContent = (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Input.Search
        className="library-search"
        value={searchQuery}
        placeholder="Поиск датасетов по названию..."
        allowClear
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <Alert
        type="info"
        showIcon
        message="Как собрать данные"
        description="Классификация: набор → классы → фото или ZIP в каждый класс. Кластеризация без учителя: один набор → только фото или ZIP (имена кластеров не нужны). Форматы: JPG, PNG, WEBP, GIF (до 10 МБ на файл)."
      />
      <Collapse
        defaultActiveKey={["images", "tabular"]}
        items={[
          {
            key: "images",
            label: "Картинки (классификация и кластеризация)",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Space wrap style={{ width: "100%" }}>
                  <Input
                    style={{ flex: 1, minWidth: 160 }}
                    value={newImageDatasetName}
                    onChange={(event) => setNewImageDatasetName(event.target.value)}
                    placeholder="Название набора, например RPS v1"
                  />
                  <Select
                    style={{ minWidth: 160 }}
                    value={newImageDatasetTaskType}
                    onChange={(v) => setNewImageDatasetTaskType(v)}
                    options={[
                      { value: "classification", label: "Классификация" },
                      { value: "clustering", label: "Кластеризация (без учителя)" }
                    ]}
                  />
                  <Button
                    type="primary"
                    disabled={newImageDatasetName.trim().length === 0}
                    onClick={() => {
                      addImageDataset(newImageDatasetName, newImageDatasetTaskType);
                      setNewImageDatasetName("");
                      message.success("Набор создан");
                    }}
                  >
                    Создать набор
                  </Button>
                </Space>
                {filteredImageDatasets.map((dataset) => (
                  <Card
                    key={dataset.id}
                    size="small"
                    title={`${dataset.title} (${dataset.taskType === "clustering" ? "Кластеризация" : "Классификация"})`}
                    extra={<Button icon={<DeleteOutlined />} onClick={() => removeImageDataset(dataset.id)} />}
                  >
                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                      {dataset.taskType === "clustering" ? (
                        <>
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            Без учителя: загрузи фото или ZIP с картинками — имена кластеров не нужны. В Blockly
                            выбери этот набор для Image KNN: похожие снимки сгруппируются автоматически (K-means
                            по признакам MobileNet).
                          </Paragraph>
                          <Text type="secondary">Снимков в наборе: {dataset.unlabeledFiles?.length ?? 0}</Text>
                          <Space wrap>
                            <Upload
                              accept="image/*"
                              multiple
                              showUploadList={false}
                              beforeUpload={(file) => {
                                const ok = filterImageSize([file], () =>
                                  message.error("Файл слишком большой (максимум 10 МБ)")
                                );
                                if (ok.length) {
                                  addUnlabeledSamplesToImageDataset(dataset.id, ok);
                                  message.success("Фото добавлено");
                                }
                                return false;
                              }}
                              customRequest={() => {}}
                            >
                              <Button icon={<UploadOutlined />} size="small">
                                Добавить фото
                              </Button>
                            </Upload>
                            <Upload
                              accept=".zip,application/zip,application/x-zip-compressed"
                              showUploadList={false}
                              beforeUpload={(file) => {
                                void (async () => {
                                  try {
                                    const extracted = await extractImageFilesFromZip(file);
                                    const ok = filterImageSize(extracted, (name) =>
                                      message.warning(`Пропуск ${name}: больше 10 МБ`)
                                    );
                                    if (ok.length === 0) {
                                      message.error("В архиве не найдено подходящих изображений");
                                      return;
                                    }
                                    addUnlabeledSamplesToImageDataset(dataset.id, ok);
                                    message.success(`Из ZIP добавлено: ${ok.length} файлов`);
                                  } catch (e) {
                                    message.error(e instanceof Error ? e.message : "Не удалось прочитать ZIP");
                                  }
                                })();
                                return false;
                              }}
                              customRequest={() => {}}
                            >
                              <Button icon={<FileZipOutlined />} size="small">
                                Загрузить ZIP
                              </Button>
                            </Upload>
                            {(dataset.unlabeledFiles?.length ?? 0) > 0 ? (
                              <>
                                <Button
                                  icon={<EyeOutlined />}
                                  size="small"
                                  onClick={() => {
                                    const urls = (dataset.unlabeledFiles ?? []).map((f) =>
                                      URL.createObjectURL(f)
                                    );
                                    setPreviewImages(urls);
                                    setPreviewVisible(true);
                                  }}
                                >
                                  Просмотр
                                </Button>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    clearUnlabeledSamples(dataset.id);
                                    message.success("Список фото очищен");
                                  }}
                                >
                                  Очистить фото
                                </Button>
                              </>
                            ) : null}
                          </Space>
                        </>
                      ) : (
                        <>
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
                                const ok = filterImageSize([file], () =>
                                  message.error("Файл слишком большой (максимум 10 МБ)")
                                );
                                if (ok.length) {
                                  addSamplesToClass(dataset.id, datasetClass.labelId, ok);
                                }
                                return false;
                              },
                              customRequest: () => {}
                            };
                            return (
                              <Card key={datasetClass.labelId} size="small">
                                <Text strong>{datasetClass.title}</Text>
                                <br />
                                <Text type="secondary">Снимков: {datasetClass.files.length}</Text>
                                <Divider style={{ margin: "8px 0" }} />
                                <Space wrap>
                                  <Upload {...uploadProps}>
                                    <Button icon={<UploadOutlined />} size="small" block>
                                      Добавить фото
                                    </Button>
                                  </Upload>
                                  <Upload
                                    accept=".zip,application/zip,application/x-zip-compressed"
                                    showUploadList={false}
                                    beforeUpload={(file) => {
                                      void (async () => {
                                        try {
                                          const extracted = await extractImageFilesFromZip(file);
                                          const ok = filterImageSize(extracted, (name) =>
                                            message.warning(`Пропуск ${name}: больше 10 МБ`)
                                          );
                                          if (ok.length === 0) {
                                            message.error("В архиве не найдено изображений");
                                            return;
                                          }
                                          addSamplesToClass(dataset.id, datasetClass.labelId, ok);
                                          message.success(`Из ZIP: ${ok.length} фото в «${datasetClass.title}»`);
                                        } catch (e) {
                                          message.error(
                                            e instanceof Error ? e.message : "Не удалось прочитать ZIP"
                                          );
                                        }
                                      })();
                                      return false;
                                    }}
                                    customRequest={() => {}}
                                  >
                                    <Button icon={<FileZipOutlined />} size="small">
                                      ZIP в класс
                                    </Button>
                                  </Upload>
                                  {datasetClass.files.length > 0 ? (
                                    <Button
                                      icon={<EyeOutlined />}
                                      size="small"
                                      onClick={() => {
                                        const urls = datasetClass.files.map((f) => URL.createObjectURL(f));
                                        setPreviewImages(urls);
                                        setPreviewVisible(true);
                                      }}
                                    >
                                      Просмотр
                                    </Button>
                                  ) : null}
                                </Space>
                              </Card>
                            );
                          })}
                        </>
                      )}
                    </Space>
                  </Card>
                ))}
              </Space>
            )
          },
          {
            key: "tabular",
            label: "Таблицы (CSV)",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Paragraph>Признаки в колонках, целевое значение — в последней колонке.</Paragraph>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={csvDatasetName}
                    onChange={(event) => setCsvDatasetName(event.target.value)}
                    placeholder="Название набора, например Students v1"
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
                          message.success("CSV добавлен");
                        } catch (error) {
                          const msg = error instanceof Error ? error.message : "Не удалось прочитать CSV";
                          setCsvError(msg);
                          message.error(msg);
                        }
                      })();
                      return false;
                    }}
                  >
                    <Button icon={<UploadOutlined />}>Загрузить CSV</Button>
                  </Upload>
                </Space.Compact>
                {filteredTabularDatasets.map((dataset) => (
                  <Card
                    key={dataset.id}
                    size="small"
                    extra={
                      <Space>
                        <Button
                          icon={<DownloadOutlined />}
                          size="small"
                          onClick={() => {
                            const csv = [
                              dataset.dataset.headers.join(","),
                              ...dataset.dataset.rows.map((r) => r.join(","))
                            ].join("\n");
                            const blob = new Blob([csv], { type: "text/csv" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `${dataset.title}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                        />
                        <Button
                          icon={<DeleteOutlined />}
                          size="small"
                          onClick={() => removeTabularDataset(dataset.id)}
                        />
                      </Space>
                    }
                  >
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
          }
        ]}
      />
    </Space>
  );

  const handleRemoveSavedModel = async (entry: SavedModelEntry) => {
    await removeStoredModelFiles(entry);
    removeSavedModel(entry.id);
    message.success("Модель удалена из библиотеки");
  };

  const predictTabContent = (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Paragraph>
        Для таблицы в блоке <Text strong>«предсказать»</Text> выбери либо один из этих входов, либо режим «Вручную» (строка
        только в блоке). Для картинок — только вход из библиотеки.
      </Paragraph>
      <Collapse
        defaultActiveKey={["img", "tab"]}
        items={[
          {
            key: "img",
            label: "Картинка для проверки",
            children: (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={imagePredictionName}
                    onChange={(event) => setImagePredictionName(event.target.value)}
                    placeholder="Название входа, например test_rock"
                  />
                  <Upload
                    accept="image/*"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      addImagePredictionInput(imagePredictionName || file.name, file);
                      setImagePredictionName("");
                      message.success("Изображение добавлено");
                      return false;
                    }}
                  >
                    <Button icon={<UploadOutlined />}>Добавить</Button>
                  </Upload>
                </Space.Compact>
                {imagePredictionInputs.map((item) => (
                  <Card
                    key={item.id}
                    size="small"
                    extra={
                      <Button icon={<DeleteOutlined />} onClick={() => removeImagePredictionInput(item.id)} />
                    }
                  >
                    <Text strong>{item.title}</Text>
                  </Card>
                ))}
              </Space>
            )
          },
          {
            key: "tab",
            label: "Числа для таблицы (табличный вход)",
            children: (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={tabularPredictionName}
                    onChange={(event) => setTabularPredictionName(event.target.value)}
                    placeholder="Название входа, например student_a"
                  />
                  <Input
                    value={tabularPredictionValue}
                    onChange={(event) => setTabularPredictionValue(event.target.value)}
                    placeholder="Через запятую: 6,7,1"
                  />
                  <Button
                    type="primary"
                    onClick={() => {
                      addTabularPredictionInput(tabularPredictionName || "tabular_input", tabularPredictionValue);
                      setTabularPredictionName("");
                      setTabularPredictionValue("");
                      message.success("Вход добавлен");
                    }}
                  >
                    Добавить
                  </Button>
                </Space.Compact>
                {tabularPredictionInputs.map((item) => (
                  <Card
                    key={item.id}
                    size="small"
                    extra={
                      <Button icon={<DeleteOutlined />} onClick={() => removeTabularPredictionInput(item.id)} />
                    }
                  >
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
    </Space>
  );

  const modelsTabContent = (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Paragraph type="secondary">
        Сохраняются блоком «Сохранить модель в библиотеку» после обучения. Веса лежат в IndexedDB этого браузера; в проект
        попадает только список имён — на другом устройстве загрузка не подтянет файлы, пока модель не сохранена там же.
      </Paragraph>
      {savedModels.length === 0 ? (
        <Text type="secondary">Пока нет сохранённых моделей</Text>
      ) : null}
      {savedModels.map((m) => (
        <Card
          key={m.id}
          size="small"
          extra={
            <Button danger size="small" icon={<DeleteOutlined />} onClick={() => void handleRemoveSavedModel(m)}>
              Удалить
            </Button>
          }
        >
          <Text strong>{m.title}</Text>
          <br />
          <Text type="secondary">
            {MODEL_TYPE_LABEL[m.modelType]} · {new Date(m.createdAt).toLocaleString("ru-RU")}
          </Text>
        </Card>
      ))}
    </Space>
  );

  return (
    <Card title="Библиотека данных" size="small">
      <Tabs
        defaultActiveKey="train"
        items={[
          {
            key: "train",
            label: "Данные для обучения",
            children: trainTabContent
          },
          {
            key: "predict",
            label: "Данные для предсказания",
            children: predictTabContent
          },
          {
            key: "models",
            label: "Сохранённые модели",
            children: modelsTabContent
          }
        ]}
      />
      <Modal
        open={previewVisible}
        onCancel={closePreview}
        footer={null}
        width={800}
        title="Предпросмотр изображений"
        destroyOnClose
      >
        <List
          grid={{ gutter: 16, column: 4 }}
          dataSource={previewImages}
          renderItem={(src) => (
            <List.Item>
              <Image src={src} alt="preview" style={{ width: "100%", height: 100, objectFit: "cover" }} />
            </List.Item>
          )}
        />
      </Modal>
    </Card>
  );
}
