import { Card, Space, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppStore } from "@/store/useAppStore";
import type { StudioGoal } from "@/shared/types/lessonContent";

const { Text } = Typography;

export type StudioStagePanelProps = {
  /** Мини-студия в уроке: инструкция + цели на «сцене» */
  mode?: "scratch" | "mini_coach";
  instructionMarkdown?: string;
  goals?: StudioGoal[];
  goalStatus?: Record<string, boolean>;
  allGoalsDone?: boolean;
};

/** Панель «сцены»: статус сценария; в мини-студии — персонаж, инструкция и цели. */
export function StudioStagePanel({
  mode = "scratch",
  instructionMarkdown = "",
  goals = [],
  goalStatus = {},
  allGoalsDone = false
}: StudioStagePanelProps) {
  const message = useAppStore((s) => s.training.message);

  if (mode === "mini_coach") {
    return (
      <aside className="studio-stage-panel studio-stage-panel--mini" aria-label="Сцена">
        <Card size="small" title="Сцена" className="studio-stage-card">
          <div className="studio-stage-panel__mini-layout">
            <div className="studio-stage-panel__mini-figure-wrap">
              <img className="studio-stage-panel__mini-figure" src="/nodly-coach.svg" alt="" width={56} height={56} />
            </div>
            <div className="studio-stage-panel__mini-copy">
              {instructionMarkdown.trim() ? (
                <div className="studio-stage-panel__mini-instruction lesson-flow__markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{instructionMarkdown}</ReactMarkdown>
                </div>
              ) : null}
              {goals.length > 0 ? (
                <div className="studio-stage-panel__mini-goals">
                  <Text strong>Цели</Text>
                  <Space direction="vertical" size={4} style={{ width: "100%" }}>
                    {goals.map((goal) => (
                      <div key={goal.id} className="studio-stage-panel__mini-goal-row">
                        <Tag color={goalStatus[goal.id] ? "success" : "default"}>
                          {goalStatus[goal.id] ? "Готово" : "Ждём"}
                        </Tag>
                        <Text>{goal.title}</Text>
                      </div>
                    ))}
                  </Space>
                </div>
              ) : null}
              {allGoalsDone ? (
                <Text type="success">Все цели выполнены — отличная работа!</Text>
              ) : null}
              <div className="studio-stage-panel__mini-status">
                <Text type="secondary">{message || "Нажми «Старт» в Blockly, чтобы запустить сценарий."}</Text>
              </div>
            </div>
          </div>
        </Card>
      </aside>
    );
  }

  return (
    <aside className="studio-stage-panel" aria-label="Сцена">
      <Card size="small" title="Сцена" className="studio-stage-card">
        <div className="studio-stage-panel__bubble">{message || "Нажми «Старт» в Blockly, чтобы запустить сценарий."}</div>
      </Card>
    </aside>
  );
}
