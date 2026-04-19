import { Tabs } from "antd";
import { StudioMetricsPanel } from "@/app/StudioMetricsPanel";
import { StudioStagePanel } from "@/app/StudioStagePanel";
import type { StudioGoal } from "@/shared/types/lessonContent";

type MiniSideProps = {
  instructionMarkdown: string;
  goals: StudioGoal[];
  goalStatus: Record<string, boolean>;
  allGoalsDone: boolean;
  showGoalsInPanel?: boolean;
};

export type StudioSidePanelTabsProps =
  | { variant: "full" }
  | ({ variant: "mini" } & MiniSideProps);

/** Одна колонка справа от Blockly: вкладки «Сцена» и «Визуализация» (как раньше по ширине). */
export function StudioSidePanelTabs(props: StudioSidePanelTabsProps) {
  const isMini = props.variant === "mini";
  const rootClass = `studio-page__side-tabs${isMini ? " studio-page__side-tabs--mini" : " studio-page__side-tabs--full"}`;

  const sceneChildren =
    props.variant === "mini" ? (
      <StudioStagePanel
        mode="mini_coach"
        instructionMarkdown={props.instructionMarkdown}
        goals={props.goals}
        goalStatus={props.goalStatus}
        allGoalsDone={props.allGoalsDone}
        showGoalsInPanel={props.showGoalsInPanel ?? true}
      />
    ) : (
      <StudioStagePanel />
    );

  return (
    <div className={rootClass}>
      <Tabs
        size="small"
        destroyInactiveTabPane={false}
        className="studio-page__side-tabs-inner"
        items={[
          { key: "scene", label: "Сцена", children: sceneChildren },
          { key: "viz", label: "Визуализация", children: <StudioMetricsPanel embedded /> }
        ]}
      />
    </div>
  );
}
