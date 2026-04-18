import { Space, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppStore } from "@/store/useAppStore";
import type { CoachMood } from "@/shared/types/ai";
import type { StudioGoal } from "@/shared/types/lessonContent";

const { Text } = Typography;

const MOOD_IMAGE: Record<CoachMood, string> = {
  idle: "/coach/idle.png",
  working: "/coach/working.png",
  talking: "/coach/talking.png",
  success: "/coach/success.png",
  error: "/coach/error.png"
};

export type MiniCoachOverlayProps = {
  goals: StudioGoal[];
  goalStatus: Record<string, boolean>;
  allGoalsDone: boolean;
  instructionMarkdown: string;
};

export function MiniStudioCoachOverlay({
  goals,
  goalStatus,
  allGoalsDone,
  instructionMarkdown
}: MiniCoachOverlayProps) {
  const { message, coachMood } = useAppStore((s) => ({
    message: s.training.message,
    coachMood: s.training.coachMood
  }));

  const imgSrc = MOOD_IMAGE[coachMood] ?? MOOD_IMAGE.idle;

  return (
    <div className="mini-coach-overlay" aria-live="polite">
      <div className="mini-coach-overlay__panel">
        <div className="mini-coach-overlay__row">
          <img className="mini-coach-overlay__avatar" src={imgSrc} alt="" width={72} height={72} />
          <div className="mini-coach-overlay__body">
            {instructionMarkdown.trim() ? (
              <div className="mini-coach-overlay__instruction lesson-flow__markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{instructionMarkdown}</ReactMarkdown>
              </div>
            ) : null}
            {goals.length > 0 ? (
              <div className="mini-coach-overlay__goals">
                <Text strong className="mini-coach-overlay__goals-title">
                  Цели
                </Text>
                <Space direction="vertical" size={2} style={{ width: "100%" }}>
                  {goals.map((goal) => (
                    <div key={goal.id} className="mini-coach-overlay__goal-row">
                      <Tag color={goalStatus[goal.id] ? "success" : "default"} style={{ margin: 0 }}>
                        {goalStatus[goal.id] ? "Готово" : "Ждём"}
                      </Tag>
                      <Text className="mini-coach-overlay__goal-text">{goal.title}</Text>
                    </div>
                  ))}
                </Space>
              </div>
            ) : null}
            {allGoalsDone ? (
              <Text type="success" className="mini-coach-overlay__all-done">
                Все цели выполнены — отличная работа!
              </Text>
            ) : null}
            <div className="mini-coach-overlay__bubble">
              <Text type="secondary">{message || "Нажми «Старт» в Blockly."}</Text>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
