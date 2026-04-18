import { Card } from "antd";
import { useAppStore } from "@/store/useAppStore";

/** Панель «сцены» в полной студии: сообщение из сценария Blockly. */
export function StudioStagePanel() {
  const message = useAppStore((s) => s.training.message);

  return (
    <aside className="studio-stage-panel" aria-label="Сцена">
      <Card size="small" title="Сцена" className="studio-stage-card">
        <div className="studio-stage-panel__bubble">{message || "Нажми «Старт» в Blockly, чтобы запустить сценарий."}</div>
      </Card>
    </aside>
  );
}
