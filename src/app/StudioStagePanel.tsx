import { Card, Space, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import type { StudioGoal } from "@/shared/types/lessonContent";
import { coachPngForMood, resolveCoachMood } from "@/shared/coachMood";

const { Text } = Typography;

export type StudioStagePanelProps = {
  /** `mini_coach` — урок; иначе — полная разработка с персонажем. */
  mode?: "scratch" | "mini_coach";
  instructionMarkdown?: string;
  goals?: StudioGoal[];
  goalStatus?: Record<string, boolean>;
  allGoalsDone?: boolean;
  /** Если false — цели показываются только на воркспейсе (оверлей), здесь только персонаж и текст. */
  showGoalsInPanel?: boolean;
};

/** Панель «сцены»: статус сценария; в мини-студии — персонаж, инструкция и цели. */
export function StudioStagePanel({
  mode = "scratch",
  instructionMarkdown = "",
  goals = [],
  goalStatus = {},
  allGoalsDone = false,
  showGoalsInPanel = true
}: StudioStagePanelProps) {
  const training = useAppStore((s) => s.training);
  const evaluation = useAppStore((s) => s.evaluation);
  const prediction = useAppStore((s) => s.prediction);
  const message = training.message;
  const coachSrc = useMemo(() => coachPngForMood(resolveCoachMood(training)), [training]);

  if (mode === "mini_coach") {
    return (
      <aside className="studio-stage-panel studio-stage-panel--mini" aria-label="Сцена">
        <Card size="small" title="Сцена" className="studio-stage-card">
          <div className="studio-stage-panel__mini-layout">
            <div className="studio-stage-panel__mini-figure-wrap">
              <img className="studio-stage-panel__mini-figure" src={coachSrc} alt="" />
            </div>
            <div className="studio-stage-panel__mini-copy">
              {instructionMarkdown.trim() ? (
                <div className="studio-stage-panel__mini-instruction lesson-flow__markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{instructionMarkdown}</ReactMarkdown>
                </div>
              ) : null}
              {showGoalsInPanel && goals.length > 0 ? (
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
              {showGoalsInPanel && allGoalsDone ? (
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
    <aside className="studio-stage-panel studio-stage-panel--full-coach" aria-label="Сцена">
      <Card size="small" title="Сцена" className="studio-stage-card">
        <div className="studio-stage-panel__full-layout">
          <div className="studio-stage-panel__full-figure-wrap">
            <img className="studio-stage-panel__full-figure" src={coachSrc} alt="" />
          </div>
          <div className="studio-stage-panel__full-copy">
            <div className="studio-stage-panel__full-bubble">
              {message || "Нажми «Старт» в Blockly, чтобы запустить сценарий."}
            </div>
            {evaluation ? (
              <div className="studio-stage-panel__full-extra">
                <Text strong>Модель: </Text>
                <Text>{evaluation.summary}</Text>
              </div>
            ) : null}
            {prediction ? (
              <div className="studio-stage-panel__full-extra">
                <Text strong>Предсказание: </Text>
                <Text>
                  {prediction.title} ({(prediction.confidence * 100).toFixed(0)}% уверенности)
                </Text>
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </aside>
  );
}
