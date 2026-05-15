import { Card, Empty, Space, Table, Tabs, Typography } from "antd";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useId, useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import type {
  ClassificationExampleRow,
  ConfusionMatrixData,
  ModelComparisonReport,
  RegressionExampleRow,
  TabularPredictionBatchRow,
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
    testR2: "R² (тест)",
    testMedianAE: "MedAE — медиана |y−ŷ| (тест)",
    testMaxAbsError: "Max |y−ŷ| (тест)",
    testSMAPE: "sMAPE (тест), %",
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
  if (key === "testSMAPE") {
    return `${value.toFixed(2)}%`;
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

const KID_TRAIN_METRIC_KEYS = new Set([
  "testAccuracy",
  "testLoss",
  "accuracy",
  "loss",
  "valAccuracy",
  "valLoss",
  "samples"
]);

function filterKidTrainingMetrics(metrics: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(metrics)) {
    if (KID_TRAIN_METRIC_KEYS.has(k) && typeof v === "number") {
      out[k] = v;
    }
  }
  return out;
}

function EpochCharts({ report }: { report: TrainingRunReport }) {
  const uid = useId().replace(/:/g, "");
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
  const axisTick = { fontSize: 10, fill: "rgba(148, 163, 184, 0.95)" };
  const gridStroke = "rgba(148, 163, 184, 0.18)";
  const tipStyle = {
    borderRadius: 12,
    border: "1px solid rgba(148, 163, 184, 0.28)",
    background: "color-mix(in srgb, var(--surface-floating, rgba(255,255,255,0.9)) 88%, transparent)",
    backdropFilter: "blur(12px)",
    fontSize: 12
  } as const;
  const margin = { top: 6, right: 8, left: 2, bottom: 2 };
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <div className="studio-metrics-chart-shell">
        <div className="studio-metrics-chart-shell__head">
          <Text strong>Потери (loss)</Text>
        </div>
        <div className="studio-metrics-chart-shell__plot studio-metrics-line-chart">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={rows} margin={margin}>
              <defs>
                <linearGradient id={`${uid}-loss-train`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#6aa3ff" />
                  <stop offset="100%" stopColor="#9d7bff" />
                </linearGradient>
                <linearGradient id={`${uid}-loss-val`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#34d399" />
                  <stop offset="100%" stopColor="#30d7d2" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 6" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="epoch" tick={axisTick} axisLine={false} tickLine={false} tickMargin={6} />
              <YAxis tick={axisTick} width={36} axisLine={false} tickLine={false} tickMargin={4} />
              <Tooltip contentStyle={tipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
              <Line
                type="monotone"
                dataKey="loss"
                name="train"
                stroke={`url(#${uid}-loss-train)`}
                dot={false}
                strokeWidth={2.25}
                strokeLinecap="round"
              />
              <Line
                type="monotone"
                dataKey="valLoss"
                name="val"
                stroke={`url(#${uid}-loss-val)`}
                dot={false}
                strokeWidth={2.25}
                strokeLinecap="round"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {hasAcc ? (
        <div className="studio-metrics-chart-shell">
          <div className="studio-metrics-chart-shell__head">
            <Text strong>Точность (accuracy)</Text>
          </div>
          <div className="studio-metrics-chart-shell__plot studio-metrics-line-chart">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={rows} margin={margin}>
                <defs>
                  <linearGradient id={`${uid}-acc-train`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#9d7bff" />
                    <stop offset="100%" stopColor="#6aa3ff" />
                  </linearGradient>
                  <linearGradient id={`${uid}-acc-val`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="100%" stopColor="#5eead4" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 6" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="epoch" tick={axisTick} axisLine={false} tickLine={false} tickMargin={6} />
                <YAxis domain={[0, 1]} tick={axisTick} width={36} axisLine={false} tickLine={false} tickMargin={4} />
                <Tooltip
                  contentStyle={tipStyle}
                  formatter={(v: number | string) => [typeof v === "number" ? `${(v * 100).toFixed(1)}%` : v, ""]}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                <Line
                  type="monotone"
                  dataKey="accuracy"
                  name="train"
                  stroke={`url(#${uid}-acc-train)`}
                  dot={false}
                  strokeWidth={2.25}
                  strokeLinecap="round"
                />
                <Line
                  type="monotone"
                  dataKey="valAccuracy"
                  name="val"
                  stroke={`url(#${uid}-acc-val)`}
                  dot={false}
                  strokeWidth={2.25}
                  strokeLinecap="round"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
      {hasMse && !hasAcc ? (
        <div className="studio-metrics-chart-shell">
          <div className="studio-metrics-chart-shell__head">
            <Text strong>MSE</Text>
          </div>
          <div className="studio-metrics-chart-shell__plot studio-metrics-line-chart">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={rows} margin={margin}>
                <defs>
                  <linearGradient id={`${uid}-mse-train`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#8b7ae8" />
                    <stop offset="100%" stopColor="#6aa3ff" />
                  </linearGradient>
                  <linearGradient id={`${uid}-mse-val`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3db8b4" />
                    <stop offset="100%" stopColor="#5ec8b8" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 6" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="epoch" tick={axisTick} axisLine={false} tickLine={false} tickMargin={6} />
                <YAxis tick={axisTick} width={44} axisLine={false} tickLine={false} tickMargin={4} />
                <Tooltip contentStyle={tipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                <Line
                  type="monotone"
                  dataKey="mse"
                  name="train mse"
                  stroke={`url(#${uid}-mse-train)`}
                  dot={false}
                  strokeWidth={2.25}
                  strokeLinecap="round"
                />
                <Line
                  type="monotone"
                  dataKey="valMse"
                  name="val mse"
                  stroke={`url(#${uid}-mse-val)`}
                  dot={false}
                  strokeWidth={2.25}
                  strokeLinecap="round"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
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

function ComparisonPanel({ comparison }: { comparison: ModelComparisonReport }) {
  const rows = comparison.rows.map((row) => ({
    ...row,
    primaryValueFmt:
      row.primaryMetricKey === "testAccuracy"
        ? `${(row.primaryMetricValue * 100).toFixed(1)}%`
        : row.primaryMetricValue.toFixed(4),
    scorePct: Number((row.universalScore * 100).toFixed(1))
  }));
  const accuracyRows = rows.reduce<Array<{ modelType: string; testAccuracy: number }>>((acc, r) => {
    if (typeof r.metrics?.testAccuracy === "number") {
      acc.push({ modelType: r.modelType, testAccuracy: r.metrics.testAccuracy });
    }
    return acc;
  }, []);
  const maxEpoch = rows.reduce((m, r) => Math.max(m, r.epochHistory?.length ?? 0), 0);
  const overlayRows = Array.from({ length: maxEpoch }, (_, i) => {
    const epoch = i + 1;
    const row: Record<string, number> = { epoch };
    for (const r of rows) {
      const e = r.epochHistory?.[i];
      if (e) {
        if (typeof e.loss === "number") {
          row[`${r.modelType}_loss`] = e.loss;
        }
        if (typeof e.valLoss === "number") {
          row[`${r.modelType}_valLoss`] = e.valLoss;
        }
        if (typeof e.accuracy === "number") {
          row[`${r.modelType}_acc`] = e.accuracy;
        } else if (typeof r.metrics?.testAccuracy === "number") {
          // Фолбек: если в истории нет accuracy (напр. часть моделей), рисуем горизонталь по testAccuracy.
          row[`${r.modelType}_acc`] = r.metrics.testAccuracy;
        }
        if (typeof e.valAccuracy === "number") {
          row[`${r.modelType}_valAcc`] = e.valAccuracy;
        }
      } else if (typeof r.metrics?.testAccuracy === "number") {
        row[`${r.modelType}_acc`] = r.metrics.testAccuracy;
      }
    }
    return row;
  });
  const hasLossOverlay = rows.some((r) => (r.epochHistory?.length ?? 0) > 0);
  const accSeries = rows.filter((r) =>
    overlayRows.some((or) => Number.isFinite(or[`${r.modelType}_acc`]))
  );
  const hasAccOverlay = accSeries.length > 0 && overlayRows.length > 0;
  if (!rows.length) {
    return null;
  }
  const tabs = rows.map((row) => {
    const report: TrainingRunReport = {
      kind: row.kind,
      modelType: row.modelType,
      summary: row.summary,
      metrics: row.metrics ?? {},
      epochHistory: row.epochHistory ?? [],
      confusionMatrix: row.confusionMatrix,
      classificationExamples: row.classificationExamples,
      regressionExamples: row.regressionExamples
    };
    return {
      key: row.modelType,
      label: row.modelType,
      children: (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Text type="secondary">{row.summary}</Text>
          <EpochCharts report={report} />
          <ConfusionTable report={report} />
          <ExamplesTable report={report} />
          <MetricsTable report={report} />
        </Space>
      )
    };
  });
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <div>
        <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
          Сравнение моделей
        </Title>
        <Text type="secondary">
          Универсальный score: для классификации это Accuracy, для регрессии — нормализованный показатель качества
          (для 0/1 целей близок к 1−MAE).
        </Text>
      </div>
      <div className="studio-metrics-panel__chart-wrap">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
            <XAxis dataKey="modelType" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={40} />
            <Tooltip formatter={(v: number | string) => [typeof v === "number" ? `${v.toFixed(1)}%` : v, "score"]} />
            <Legend />
            <Bar dataKey="scorePct" name="universal score, %" fill="#1677ff" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {accuracyRows.length > 0 ? (
        <div className="studio-metrics-panel__chart-wrap">
          <Text strong>Сравнение test accuracy</Text>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={accuracyRows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
              <XAxis dataKey="modelType" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} width={40} />
              <Tooltip formatter={(v: number | string) => [typeof v === "number" ? `${(v * 100).toFixed(1)}%` : v, "accuracy"]} />
              <Legend />
              <Bar dataKey="testAccuracy" name="test accuracy" fill="#52c41a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      {hasLossOverlay ? (
        <div className="studio-metrics-panel__chart-wrap">
          <Text strong>Сравнение loss (наложение)</Text>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={overlayRows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
              <XAxis dataKey="epoch" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} />
              <Tooltip />
              <Legend />
              {rows.map((r, idx) => (
                <Line
                  key={`${r.modelType}-loss`}
                  type="monotone"
                  dataKey={`${r.modelType}_loss`}
                  name={`${r.modelType} train`}
                  dot={false}
                  strokeWidth={2}
                  stroke={["#1677ff", "#52c41a", "#fa8c16"][idx % 3]}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      {hasAccOverlay ? (
        <div className="studio-metrics-panel__chart-wrap">
          <Text strong>Сравнение accuracy (наложение)</Text>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={overlayRows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
              <XAxis dataKey="epoch" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} width={40} />
              <Tooltip formatter={(v: number | string) => [typeof v === "number" ? `${(v * 100).toFixed(1)}%` : v, ""]} />
              <Legend />
              {accSeries.map((r, idx) => (
                <Line
                  key={`${r.modelType}-acc`}
                  type="monotone"
                  dataKey={`${r.modelType}_acc`}
                  name={`${r.modelType} train`}
                  dot={false}
                  strokeWidth={2}
                  stroke={["#722ed1", "#13c2c2", "#eb2f96"][idx % 3]}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <Table
        size="small"
        pagination={false}
        rowKey={(r) => `${r.modelType}-${r.primaryMetricKey}`}
        scroll={{ x: 680 }}
        columns={[
          { title: "Модель", dataIndex: "modelType", key: "m", width: 200, ellipsis: true },
          { title: "Главная", dataIndex: "primaryMetricKey", key: "pk", width: 120 },
          { title: "Значение", dataIndex: "primaryValueFmt", key: "pv", width: 120 },
          {
            title: "Score",
            dataIndex: "scorePct",
            key: "s",
            width: 120,
            render: (v: number) => `${v.toFixed(1)}%`
          }
        ]}
        dataSource={rows}
      />
      <div>
        <Text strong>Детали по моделям</Text>
        <Tabs
          style={{ marginTop: 8 }}
          size="small"
          items={tabs}
          tabBarGutter={8}
        />
      </div>
    </Space>
  );
}

export type StudioMetricsPanelProps = {
  /** Внутри вкладки «Визуализация» — без дублирующего заголовка карточки и фиксированной ширины колонки. */
  embedded?: boolean;
  /** Квест «Ирисы»: только простые метрики, без графиков и «лишних» таблиц. */
  kidSimpleViz?: boolean;
};

/** Метрики последнего обучения, графики, матрица, примеры, последнее предсказание. */
export function StudioMetricsPanel({ embedded = false, kidSimpleViz = false }: StudioMetricsPanelProps) {
  const report = useAppStore((s) => s.trainingRunReport);
  const prediction = useAppStore((s) => s.prediction);
  const predictionBatch = useAppStore((s) => s.predictionBatch);
  const comparison = useAppStore((s) => s.modelComparisonReport);
  const predictionIsRegression =
    prediction?.labelId === "regression_output" || report?.kind === "tabular_regression";

  const emptyBody = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        kidSimpleViz
          ? "Запусти обучение или предсказание — здесь появятся цифры."
          : "Запусти обучение или предсказание — здесь появятся метрики и графики."
      }
    />
  );

  const filledBody = useMemo(() => {
    if (kidSimpleViz) {
      return (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          {report ? (
            <div>
              <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
                Итог обучения
              </Title>
              <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                {report.summary}
              </Text>
              <MetricsTable report={{ ...report, metrics: filterKidTrainingMetrics(report.metrics) }} />
            </div>
          ) : null}
          {predictionBatch && predictionBatch.length > 0 ? (
            <div>
              <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
                Предсказания по файлу
              </Title>
              <Table<TabularPredictionBatchRow>
                size="small"
                pagination={false}
                rowKey={(r) => `b-${r.rowIndex}`}
                dataSource={predictionBatch}
                columns={[
                  { title: "Строка", dataIndex: "rowIndex", key: "r", width: 72 },
                  { title: "Класс", dataIndex: "title", key: "t" },
                  {
                    title: "Уверенность",
                    dataIndex: "confidence",
                    key: "c",
                    render: (v: number) => `${(v * 100).toFixed(1)}%`
                  }
                ]}
              />
            </div>
          ) : null}
          {prediction && (!predictionBatch || predictionBatch.length === 0) ? (
            <div>
              <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
                Последнее предсказание
              </Title>
              <Text>
                {predictionIsRegression ? "Прогноз" : "Класс"}: <strong>{prediction.title}</strong>
              </Text>
              <br />
              {!predictionIsRegression ? (
                <Text type="secondary">Уверенность: {(prediction.confidence * 100).toFixed(1)}%</Text>
              ) : null}
            </div>
          ) : null}
        </Space>
      );
    }
    return (
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {comparison ? <ComparisonPanel comparison={comparison} /> : null}
        {report ? (
          <>
            <div>
              <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
                По эпохам
              </Title>
              <EpochCharts report={report} />
            </div>
            <ConfusionTable report={report} />
            <ExamplesTable report={report} />
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
          </>
        ) : null}
        {prediction ? (
          <div>
            <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
              Последнее предсказание
            </Title>
            <Text>
              {predictionIsRegression ? "Прогноз" : "Класс"}: <strong>{prediction.title}</strong>
            </Text>
            <br />
            {!predictionIsRegression ? (
              <Text type="secondary">Уверенность: {(prediction.confidence * 100).toFixed(1)}%</Text>
            ) : null}
          </div>
        ) : null}
      </Space>
    );
  }, [kidSimpleViz, report, prediction, predictionBatch, comparison, predictionIsRegression]);

  const hasContent = kidSimpleViz
    ? Boolean(report || prediction || (predictionBatch && predictionBatch.length > 0))
    : Boolean(report || prediction || comparison);

  if (embedded) {
    return (
      <div className="studio-metrics-panel studio-metrics-panel--embedded" aria-label="Визуализация">
        <Card size="small" className="studio-metrics-card" bordered={false}>
          {!hasContent ? emptyBody : filledBody}
        </Card>
      </div>
    );
  }

  if (!hasContent) {
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
