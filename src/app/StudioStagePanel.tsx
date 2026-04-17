import { Card, Typography } from "antd";
import { useAppStore } from "@/store/useAppStore";

const { Text } = Typography;

/** Панель «сцены» в духе Scratch: персонаж-заглушка + последнее сообщение из сценария / статуса. */
export function StudioStagePanel() {
  const message = useAppStore((s) => s.training.message);

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
      </Card>
    </aside>
  );
}
