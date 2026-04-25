import { Tabs } from "antd";
import { StudioMetricsPanel } from "@/app/StudioMetricsPanel";
import { StudioStagePanel } from "@/app/StudioStagePanel";
import { StudioSpriteSettingsTab } from "@/app/StudioSpriteSettingsTab";
import type { StudioGoal } from "@/shared/types/lessonContent";

type MiniSideProps = {
  instructionMarkdown: string;
  goals: StudioGoal[];
  goalStatus: Record<string, boolean>;
  allGoalsDone: boolean;
  showGoalsInPanel?: boolean;
};

type CommonProps = {
  /** На мобиле панель живёт в Drawer'е, а data-onboarding — на FAB-кнопке. */
  omitOnboardingAnchor?: boolean;
};

export type StudioSidePanelTabsProps =
  | ({ variant: "full" } & CommonProps)
  | ({ variant: "mini" } & MiniSideProps & CommonProps);

/** Одна колонка справа от Blockly: вкладки «Сцена» и «Визуализация» (как раньше по ширине). */
export function StudioSidePanelTabs(props: StudioSidePanelTabsProps) {
  const isMini = props.variant === "mini";
  const omitAnchor = props.omitOnboardingAnchor === true;
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

  const tabItems = [
    { key: "scene", label: "Сцена", children: sceneChildren },
    { key: "viz", label: "Визуализация", children: <StudioMetricsPanel embedded /> }
  ];
  if (!isMini) {
    tabItems.push({ key: "sprite", label: "Персонаж", children: <StudioSpriteSettingsTab /> });
  }

  return (
    <div
      className={rootClass}
      data-onboarding={isMini || omitAnchor ? undefined : "studio-side-panel"}
    >
      <Tabs
        size="small"
        destroyInactiveTabPane={false}
        className="studio-page__side-tabs-inner"
        items={tabItems}
      />
    </div>
  );
}
