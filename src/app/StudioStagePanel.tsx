import { Card, Space, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import type { StudioGoal } from "@/shared/types/lessonContent";
import { coachPngForMood, resolveCoachMood } from "@/shared/coachMood";
import { COACH_AUTO_RESULTS_LEAD, buildCoachBriefLines } from "@/shared/coachCaption";
import { StudioLiveMetrics } from "@/components/StudioLiveMetrics";

const { Text } = Typography;

const IDLE_HINT = "Нажми «Старт» в Blockly, чтобы запустить сценарий.";
const SCENARIO_WORKING_HINT = "Выполняю сценарий…";

function useCoachBubbleText(): string {
  const training = useAppStore((s) => s.training);
  const coachUserMessage = useAppStore((s) => s.coachUserMessage);
  const evaluation = useAppStore((s) => s.evaluation);
  const prediction = useAppStore((s) => s.prediction);
  const comparison = useAppStore((s) => s.modelComparisonReport);

  return useMemo(() => {
    if (training.isTraining) {
      return training.message?.trim() || "Выполняю…";
    }
    if (training.scenarioActive) {
      return training.message?.trim() || SCENARIO_WORKING_HINT;
    }
    if (coachUserMessage?.trim()) {
      return coachUserMessage.trim();
    }
    if (evaluation || prediction || comparison) {
      return COACH_AUTO_RESULTS_LEAD;
    }
    if (training.message?.trim()) {
      return training.message.trim();
    }
    return IDLE_HINT;
  }, [
    training.isTraining,
    training.scenarioActive,
    training.message,
    coachUserMessage,
    evaluation,
    prediction,
    comparison
  ]);
}

function CoachBriefBlock() {
  const training = useAppStore((s) => s.training);
  const evaluation = useAppStore((s) => s.evaluation);
  const prediction = useAppStore((s) => s.prediction);
  const comparison = useAppStore((s) => s.modelComparisonReport);
  const lines = useMemo(() => {
    if (training.isTraining || training.scenarioActive) {
      return [];
    }
    const raw = buildCoachBriefLines(evaluation, prediction, comparison);
    /** Дублируют полосы метрик на сцене — оставляем только сводку / предсказание / сравнение. */
    return raw.filter((l) => l.key !== "acc" && l.key !== "f1");
  }, [training.isTraining, training.scenarioActive, evaluation, prediction, comparison]);
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="studio-stage-panel__brief-data">
      {lines.map((row) => (
        <div key={row.key} className="studio-stage-panel__brief-line">
          <Text strong>{row.label}: </Text>
          <Text>{row.value}</Text>
        </div>
      ))}
    </div>
  );
}

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
  const coachSrc = useMemo(() => coachPngForMood(resolveCoachMood(training)), [training]);
  const caption = useCoachBubbleText();
  const captionIsSecondary = caption === IDLE_HINT || caption === SCENARIO_WORKING_HINT;

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
              <div className="studio-stage-panel__mini-bubble">
                {captionIsSecondary ? (
                  <Text type="secondary">{caption}</Text>
                ) : (
                  <Text>{caption}</Text>
                )}
              </div>
              <CoachBriefBlock />
            </div>
            <StudioLiveMetrics compact className="studio-stage-panel__mini-metrics" />
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
              {captionIsSecondary ? (
                <Text type="secondary">{caption}</Text>
              ) : (
                <Text>{caption}</Text>
              )}
            </div>
            <CoachBriefBlock />
            <StudioLiveMetrics className="studio-stage-panel__promo-metrics" />
          </div>
        </div>
      </Card>
    </aside>
  );
}
