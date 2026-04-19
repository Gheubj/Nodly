import type { CoachMood, TrainingState } from "@/shared/types/ai";

function normalizeCoachMood(raw: CoachMood | string | undefined): CoachMood {
  if (raw === "working" || raw === "success" || raw === "error" || raw === "idle") {
    return raw;
  }
  /* legacy snapshots / persisted "talking" */
  return "idle";
}

/** Какое PNG показывать для состояния персонажа. */
export function coachPngForMood(mood: CoachMood | string | undefined): string {
  const m = normalizeCoachMood(mood);
  switch (m) {
    case "working":
      return "/coach/working.png";
    case "success":
      return "/coach/success.png";
    case "error":
      return "/coach/error.png";
    case "idle":
    default:
      return "/coach/idle.png";
  }
}

/** Согласовано с логикой Blockly / стора: явный coachMood или эвристика по полям. */
export function resolveCoachMood(training: TrainingState): CoachMood {
  if (training.coachMood) {
    return normalizeCoachMood(training.coachMood);
  }
  if (training.isTraining) {
    return "working";
  }
  const msg = (training.message || "").toLowerCase();
  if (msg.includes("ошиб") || msg.includes("error")) {
    return "error";
  }
  if (msg.trim().length > 0 && msg !== "ожидание") {
    return "idle";
  }
  return "idle";
}
