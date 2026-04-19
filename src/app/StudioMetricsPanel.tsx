import { Card, Empty, Space, Table, Typography } from "antd";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import type {
  ClassificationExampleRow,
  ConfusionMatrixData,
  RegressionExampleRow,
  TrainingRunReport
} from "@/shared/types/ai";
import { metricsFromConfusionMatrix } from "@/shared/confusionMetrics";

const { Text, Title } = Typography;

function formatMetricLabel(key: string): string {
  const map: Record<string, string> = {
    testLoss: "Потери (тест)",
    testAccuracy: "Точность (тест)",
    testMSE: "MSE (тест)",
    testMAE: "MAE (тест)",
    testRMSE: "RMSE (тест)",
    samples: "Примеров",
    macroPrecision: "Precision (macro)",
    macroRecall: "Recall (macro)",
    macroF1: "F1 (macro)",
    weightedPrecision: "Precision (взвеш.)",
    weightedRecall: "Recall (взвеш.)",
    weightedF1: "F1 (взвеш.)"
  };
  return map[key] ?? key;
}

const METRIC_PERCENT_KEYS = new Set([
  "testAccuracy",
  "macroPrecision",
  "macroRecall",
  "macroF1",
  "weightedPrecision",
  "weightedRecall",
  "weightedF1"
]);

function formatMetricValue(key: string, value: number): string {
  if (METRIC_PERCENT_KEYS.has(key) && value >= 0 && value <= 1) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toFixed(4);
}

function MetricsTable({ report }: { report: TrainingRunReport }) {
  const data = useMemo(
    () =>
      Object.entries(report.metrics).map(([key, value]) => ({
        key,
        label: formatMetricLabel(key),
        value: typeof value === "number" ? formatMetricValue(key, value) : String(value)
      })),
    [report.metrics]
  );
  return (
    <Table
      size="small"
      pagination={false}
      showHeader={false}
      columns={[
        { dataIndex: "label", key: "label", width: "52%" },
        { dataIndex: "value", key: "value" }
      ]}
      dataSource={data}
    />
  );
}

function EpochCharts({ report }: { report: TrainingRunReport }) {
  const rows = report.epochHistory;
  if (!rows.length) {
    return (
      <Text type="secondary">
        Для этой модели нет графиков по эпохам (например, KNN по изображениям). После табличного обучения здесь
        появятся кривые loss и точности.
      </Text>
    );
  }
  const hasAcc = rows.some((r) => r.accuracy != null || r.valAccuracy != null);
  const hasMse = rows.some((r) => r.mse != null || r.valMse != null);
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <div className="studio-metrics-panel__chart-wrap">
        <Text strong>Потери (loss)</Text>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
            <XAxis dataKey="epoch" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={36} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="loss" name="train" stroke="#1677ff" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="valLoss" name="val" stroke="#52c41a" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {hasAcc ? (
        <div className="studio-metrics-panel__chart-wrap">
          <Text strong>Точность (accuracy)</Text>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
              <XAxis dataKey="epoch" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} width={36} />
              <Tooltip formatter={(v: number | string) => [typeof v === "number" ? `${(v * 100).toFixed(1)}%` : v, ""]} />
              <Legend />
              <Line type="monotone" dataKey="accuracy" name="train" stroke="#722ed1" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="valAccuracy" name="val" stroke="#fa8c16" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      {hasMse && !hasAcc ? (
        <div className="studio-metrics-panel__chart-wrap">
          <Text strong>MSE</Text>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
              <XAxis dataKey="epoch" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={44} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="mse" name="train mse" stroke="#eb2f96" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="valMse" name="val mse" stroke="#13c2c2" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </Space>
  );
}

function PerClassQualityTable({ cm }: { cm: ConfusionMatrixData }) {
  const rows = useMemo(() => metricsFromConfusionMatrix(cm).perClass, [cm]);
  if (rows.length === 0) {
    return null;
  }
  return (
    <div>
      <Text strong>По классам</Text>
      <Table
        style={{ marginTop: 8 }}
        size="small"
        pagination={false}
        rowKey={(_, i) => `pc-${i}`}
        columns={[
          { title: "Класс", dataIndex: "label", key: "l", ellipsis: true },
          {
            title: "Precision",
            dataIndex: "precision",
            key: "p",
            width: 88,
            render: (v: number) => `${(v * 100).toFixed(1)}%`
          },
          {
            title: "Recall",
            dataIndex: "recall",
            key: "r",
            width: 88,
            render: (v: number) => `${(v * 100).toFixed(1)}%`
          },
          {
            title: "F1",
            dataIndex: "f1",
            key: "f",
            width: 72,
            render: (v: number) => `${(v * 100).toFixed(1)}%`
          },
          { title: "N", dataIndex: "support", key: "s", width: 52, align: "right" as const }
        ]}
        dataSource={rows}
      />
    </div>
  );
}

function ConfusionTable({ report }: { report: TrainingRunReport }) {
  const cm = report.confusionMatrix;
  if (!cm || cm.labels.length === 0) {
    return null;
  }
  const { labels, matrix } = cm;
  return (
    <div className="studio-metrics-panel__confusion">
      <Text strong>Матрица ошибок (тест)</Text>
      <table className="studio-metrics-panel__cm-table">
        <thead>
          <tr>
            <th className="studio-metrics-panel__cm-corner">Истина \ Предсказ.</th>
            {labels.map((lab) => (
              <th key={lab}>{lab}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((rowLab, i) => (
            <tr key={rowLab}>
              <th scope="row">{rowLab}</th>
              {labels.map((_, j) => (
                <td key={`${i}-${j}`} className={i === j ? "studio-metrics-panel__cm-diag" : undefined}>
                  {matrix[i]?.[j] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExamplesTable({ report }: { report: TrainingRunReport }) {
  if (report.classificationExamples?.length) {
    const rows = report.classificationExamples;
    return (
      <div>
        <Text strong>Примеры на тесте</Text>
        <Table<ClassificationExampleRow>
          size="small"
          pagination={false}
          rowKey={(_, i) => `c-${i}`}
          columns={[
            { title: "Верно", dataIndex: "trueLabel", key: "t" },
            { title: "Предсказано", dataIndex: "predictedLabel", key: "p" },
            {
              title: "Уверенность",
              dataIndex: "confidence",
              key: "c",
              render: (v: number) => `${(v * 100).toFixed(1)}%`
            }
          ]}
          dataSource={rows}
        />
      </div>
    );
  }
  if (report.regressionExamples?.length) {
    const rows = report.regressionExamples;
    return (
      <div>
        <Text strong>Примеры на тесте</Text>
        <Table<RegressionExampleRow>
          size="small"
          pagination={false}
          rowKey={(_, i) => `r-${i}`}
          columns={[
            { title: "Факт", dataIndex: "trueY", key: "t", render: (v: number) => v.toFixed(4) },
            { title: "Модель", dataIndex: "predictedY", key: "p", render: (v: number) => v.toFixed(4) },
            { title: "|ошибка|", dataIndex: "absError", key: "e", render: (v: number) => v.toFixed(4) }
          ]}
          dataSource={rows}
        />
      </div>
    );
  }
  return null;
}

export type StudioMetricsPanelProps = {
  /** Внутри вкладки «Визуализация» — без дублирующего заголовка карточки и фиксированной ширины колонки. */
  embedded?: boolean;
};

/** Метрики последнего обучения, графики, матрица, примеры, последнее предсказание. */
export function StudioMetricsPanel({ embedded = false }: StudioMetricsPanelProps) {
  const report = useAppStore((s) => s.trainingRunReport);
  const prediction = useAppStore((s) => s.prediction);

  const emptyBody = (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Запусти обучение или предсказание — здесь появятся метрики и графики." />
  );

  const filledBody = (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {report ? (
        <>
          <div>
            <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
              Итог обучения
            </Title>
            <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
              {report.summary}
            </Text>
            <MetricsTable report={report} />
            {report.confusionMatrix ? <PerClassQualityTable cm={report.confusionMatrix} /> : null}
          </div>
          <div>
            <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
              По эпохам
            </Title>
            <EpochCharts report={report} />
          </div>
          <ConfusionTable report={report} />
          <ExamplesTable report={report} />
        </>
      ) : null}
      {prediction ? (
        <div>
          <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
            Последнее предсказание
          </Title>
          <Text>
            Класс: <strong>{prediction.title}</strong>
          </Text>
          <br />
          <Text type="secondary">Уверенность: {(prediction.confidence * 100).toFixed(1)}%</Text>
        </div>
      ) : null}
    </Space>
  );

  if (embedded) {
    return (
      <div className="studio-metrics-panel studio-metrics-panel--embedded" aria-label="Визуализация">
        <Card size="small" className="studio-metrics-card" bordered={false}>
          {!report && !prediction ? emptyBody : filledBody}
        </Card>
      </div>
    );
  }

  if (!report && !prediction) {
    return (
      <aside className="studio-metrics-panel" aria-label="Визуализация">
        <Card size="small" title="Визуализация" className="studio-metrics-card">
          {emptyBody}
        </Card>
      </aside>
    );
  }

  return (
    <aside className="studio-metrics-panel" aria-label="Визуализация">
      <Card size="small" title="Визуализация" className="studio-metrics-card">
        {filledBody}
      </Card>
    </aside>
  );
}
