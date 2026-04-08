import { Card, Typography } from "antd";
import { useAppStore } from "@/store/useAppStore";

const { Paragraph, Text } = Typography;

/** Панель «сцены» в духе Scratch: персонаж-заглушка + последнее сообщение из сценария / статуса. */
export function StudioStagePanel() {
  const message = useAppStore((s) => s.training.message);
  const prediction = useAppStore((s) => s.prediction);

  return (
    <aside className="studio-stage-panel" aria-label="Сцена">
      <Card size="small" title="Сцена" className="studio-stage-card">
        <div className="studio-stage-panel__figure" aria-hidden>
          🤖
        </div>
        <Text type="secondary" style={{ display: "block", marginBottom: 6, fontSize: 12 }}>
          Персонаж
        </Text>
        <div className="studio-stage-panel__bubble">{message || "Нажми «Старт» в Blockly, чтобы запустить сценарий."}</div>
        {prediction ? (
          <Paragraph style={{ marginTop: 10, marginBottom: 0 }} type="secondary">
            Последний результат: <Text strong>{prediction.title}</Text> (
            {(prediction.confidence * 100).toFixed(1)}%)
          </Paragraph>
        ) : null}
      </Card>
    </aside>
  );
}
