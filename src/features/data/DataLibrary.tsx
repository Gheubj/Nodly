import { useMemo, useState } from "react";
import { Alert, Button, Card, Divider, Input, Space, Tabs, Typography, Upload, Progress, Modal, Image, List, Input as AntInput } from "antd";
import { UploadOutlined, DeleteOutlined, EyeOutlined, DownloadOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { useAppStore } from "@/store/useAppStore";
import { parseCsvFile } from "@/features/data/csv";

const { Paragraph, Text } = Typography;
const { Search } = AntInput;

const { Paragraph, Text } = Typography;

export function DataLibrary() {
  const [newImageDatasetName, setNewImageDatasetName] = useState("");
  const [classNames, setClassNames] = useState<Record<string, string>>({});
  const [csvDatasetName, setCsvDatasetName] = useState("");
  const [imagePredictionName, setImagePredictionName] = useState("");
  const [tabularPredictionName, setTabularPredictionName] = useState("");
  const [tabularPredictionValue, setTabularPredictionValue] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
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
    addTabularDataset,
    addImagePredictionInput,
    addTabularPredictionInput,
    removeImageDataset,
    removeTabularDataset,
    removeImagePredictionInput,
    removeTabularPredictionInput
  } = useAppStore();

  const filteredImageDatasets = useMemo(
    () => imageDatasets.filter((ds) => ds.title.toLowerCase().includes(searchQuery.toLowerCase())),
    [imageDatasets, searchQuery]
  );

  const filteredTabularDatasets = useMemo(
    () => tabularDatasets.filter((ds) => ds.title.toLowerCase().includes(searchQuery.toLowerCase())),
    [tabularDatasets, searchQuery]
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
                <Search
                  placeholder="Поиск датасетов..."
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ width: 200 }}
                />
                <Paragraph>Image dataset: создавай набор, классы и загружай изображения по классам. <Text type="secondary">Макс 500 изображений, до 10MB на файл.</Text></Paragraph>
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
                {filteredImageDatasets.map((dataset) => (
                  <Card key={dataset.id} size="small" title={dataset.title} extra={<Button icon={<DeleteOutlined />} onClick={() => removeImageDataset(dataset.id)} />}>
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
                            if (file.size > 10 * 1024 * 1024) {
                              alert("Файл слишком большой (макс 10MB)");
                              return false;
                            }
                            addSamplesToClass(dataset.id, datasetClass.labelId, [file]);
                            return false;
                          },
                          customRequest: () => {} // Disable default upload
                        };
                        return (
                          <Card key={datasetClass.labelId} size="small">
                            <Text strong>{datasetClass.title}</Text>
                            <br />
                            <Text type="secondary">Снимков: {datasetClass.files.length}</Text>
                            <Divider style={{ margin: "8px 0" }} />
                            <Space>
                              <Upload {...uploadProps} style={{ width: '100%' }}>
                                <Button icon={<UploadOutlined />} size="small" style={{ width: '100%' }}>Добавить (или перетащите файлы)</Button>
                              </Upload>
                              {datasetClass.files.length > 0 && (
                                <Button
                                  icon={<EyeOutlined />}
                                  size="small"
                                  onClick={() => {
                                    const urls = datasetClass.files.map(f => URL.createObjectURL(f));
                                    setPreviewImages(urls);
                                    setPreviewVisible(true);
                                  }}
                                >
                                  Просмотр
                                </Button>
                              )}
                            </Space>
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
                {filteredTabularDatasets.map((dataset) => (
                  <Card key={dataset.id} size="small" extra={
                    <Space>
                      <Button icon={<DownloadOutlined />} size="small" onClick={() => {
                        const csv = [dataset.dataset.headers.join(','), ...dataset.dataset.rows.map(r => r.join(','))].join('\n');
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${dataset.title}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }} />
                      <Button icon={<DeleteOutlined />} size="small" onClick={() => removeTabularDataset(dataset.id)} />
                    </Space>
                  }>
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
                  <Card key={item.id} size="small" extra={<Button icon={<DeleteOutlined />} onClick={() => removeImagePredictionInput(item.id)} />}>
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
                  <Card key={item.id} size="small" extra={<Button icon={<DeleteOutlined />} onClick={() => removeTabularPredictionInput(item.id)} />}>
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
      <Modal
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={800}
        title="Предпросмотр изображений"
      >
        <List
          grid={{ gutter: 16, column: 4 }}
          dataSource={previewImages}
          renderItem={(src) => (
            <List.Item>
              <Image src={src} alt="preview" style={{ width: '100%', height: 100, objectFit: 'cover' }} />
            </List.Item>
          )}
        />
      </Modal>
    </Card>
  );
}
