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
}

export interface LessonContentHint {
  title: string;
  text: string;
}

/** Блоки «ленты» урока (конструктор + плеер). Если заданы — плеер строит единый поток. */
export type LessonContentBlock =
  | { id: string; type: "text"; body: string }
  | { id: string; type: "image"; url: string; caption?: string | null }
  | { id: string; type: "pdf"; url: string; caption?: string | null }
  | { id: string; type: "studio"; title: string; instruction: string; ctaAction?: string | null }
  | { id: string; type: "checkpoint"; question: string; expectedAnswer: string }
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
