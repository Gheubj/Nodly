export interface LessonContentSlide {
  title: string;
  body: string;
  mediaUrl?: string | null;
}

export interface LessonContentPracticeStep {
  title: string;
  instruction: string;
  ctaAction?: string | null;
}

export interface LessonContentCheckpoint {
  question: string;
  expectedAnswer: string;
  answerMode?: "text" | "single" | "multi";
  options?: string[];
}

export interface LessonContentHint {
  title: string;
  text: string;
}

export type StudioGoalType = "add_block" | "select_dataset" | "train_model" | "run_prediction";

export type StudioGoal =
  | { id: string; title: string; type: "add_block"; blockType: string }
  | { id: string; title: string; type: "select_dataset"; datasetKind: "image" | "tabular" }
  | { id: string; title: string; type: "train_model" }
  | { id: string; title: string; type: "run_prediction" };

/** Блоки «ленты» урока (конструктор + плеер). Если заданы — плеер строит единый поток. */
export type LessonContentBlock =
  | { id: string; type: "text"; body: string }
  | { id: string; type: "media"; kind: "image" | "pdf"; url: string; caption?: string | null }
  /** Legacy: старые уроки могли хранить image/pdf отдельно. */
  | { id: string; type: "image"; url: string; caption?: string | null }
  | { id: string; type: "pdf"; url: string; caption?: string | null }
  | {
      id: string;
      type: "studio";
      instruction: string;
      ctaAction?: string | null;
      /**
       * Источник стартового проекта для мини-разработки ученика.
       * `template` — снимок из поля starterPayload шаблона урока (как раньше).
       * `project_clone` — копия облачного проекта `referenceProjectId` (админ готовит данные в «Разработка»).
       * `empty` — пустой проект; уровень Blockly задаётся только `studioWorkspaceLevel` (ученик не выбирает).
       */
      studioPracticeKind?: "template" | "project_clone" | "empty";
      /** Для `project_clone`: id облачного проекта-образца (из URL /studio?project=…) */
      referenceProjectId?: string | null;
      /** Для `empty`: уровень 1–3 (обязателен при пустой практике) */
      studioWorkspaceLevel?: 1 | 2 | 3;
      /** Цели мини-разработки: отображаются ученику и проверяются автоматически. */
      goals?: StudioGoal[];
    }
  | {
      id: string;
      type: "checkpoint";
      question: string;
      expectedAnswer: string;
      answerMode?: "text" | "single" | "multi";
      options?: string[];
    }
  | { id: string; type: "divider" };

export interface LessonContent {
  schemaVersion?: number;
  blocks?: LessonContentBlock[];
  presentationPdfUrl?: string | null;
  slides: LessonContentSlide[];
  practiceSteps: LessonContentPracticeStep[];
  checkpoints: LessonContentCheckpoint[];
  hints: LessonContentHint[];
}

export const EMPTY_LESSON_CONTENT: LessonContent = {
  presentationPdfUrl: null,
  slides: [],
  practiceSteps: [],
  checkpoints: [],
  hints: []
};
