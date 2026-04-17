export type LessonPlayerCheckpointStatus = "pending" | "ok";

export type MiniDevTelemetry = {
  trained?: boolean;
  predicted?: boolean;
  lastModelType?: string | null;
  lastDatasetRef?: string | null;
  lastInputRef?: string | null;
  lastPredictionLabel?: string | null;
  updatedAt?: string;
};

export type LessonPlayerStateV1 = {
  v: 1;
  /** Чекпоинты, сданные верно */
  checkpoints?: Record<string, LessonPlayerCheckpointStatus>;
  /** Мини-разработка: блоки, отмеченные как выполненные */
  miniDevDone?: Record<string, boolean>;
  /** Проекты мини-разработки по id блока */
  miniDevProjectIds?: Record<string, string>;
  /** Телеметрия мини-разработок (из iframe-студии) */
  miniDevTelemetry?: Record<string, MiniDevTelemetry>;
  /** Статусы целей мини-разработки */
  miniDevGoalStatus?: Record<string, Record<string, boolean>>;
};

export function normalizeCheckpointAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseLessonPlayerState(raw: unknown): LessonPlayerStateV1 {
  if (raw && typeof raw === "object" && (raw as { v?: unknown }).v === 1) {
    const v = raw as LessonPlayerStateV1;
    return {
      v: 1,
      checkpoints: v.checkpoints ?? {},
      miniDevDone: v.miniDevDone ?? {},
      miniDevProjectIds: v.miniDevProjectIds ?? {},
      miniDevTelemetry: v.miniDevTelemetry ?? {},
      miniDevGoalStatus: v.miniDevGoalStatus ?? {}
    };
  }
  return { v: 1, checkpoints: {}, miniDevDone: {}, miniDevProjectIds: {}, miniDevTelemetry: {}, miniDevGoalStatus: {} };
}
