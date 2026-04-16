import type { LessonContent, LessonContentBlock } from "@/shared/types/lessonContent";

export function newLessonBlockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Если в контенте уже есть blocks — используем их; иначе собираем из legacy-полей (одна «лента»). */
export function expandLessonContentToBlocks(lc: LessonContent): LessonContentBlock[] {
  if (Array.isArray(lc.blocks)) {
    if (lc.blocks.length > 0) {
      return lc.blocks;
    }
    if (lc.schemaVersion === 2) {
      return [];
    }
  }
  const out: LessonContentBlock[] = [];
  if (lc.presentationPdfUrl) {
    out.push({
      id: newLessonBlockId(),
      type: "pdf",
      url: lc.presentationPdfUrl,
      caption: "Презентация"
    });
  }
  for (let i = 0; i < lc.slides.length; i++) {
    const s = lc.slides[i];
    const body = [s.title ? `# ${s.title}` : "", s.body].filter(Boolean).join("\n\n");
    if (body.trim()) {
      out.push({ id: newLessonBlockId(), type: "text", body });
    }
    if (s.mediaUrl) {
      out.push({ id: newLessonBlockId(), type: "image", url: s.mediaUrl, caption: null });
    }
  }
  for (let i = 0; i < lc.practiceSteps.length; i++) {
    const p = lc.practiceSteps[i];
    out.push({
      id: newLessonBlockId(),
      type: "studio",
      title: p.title,
      instruction: p.instruction,
      ctaAction: p.ctaAction ?? null
    });
  }
  for (let i = 0; i < lc.checkpoints.length; i++) {
    const c = lc.checkpoints[i];
    out.push({
      id: newLessonBlockId(),
      type: "checkpoint",
      question: c.question,
      expectedAnswer: c.expectedAnswer
    });
  }
  for (let i = 0; i < lc.hints.length; i++) {
    const h = lc.hints[i];
    out.push({
      id: newLessonBlockId(),
      type: "text",
      body: `**${h.title}**\n\n${h.text}`
    });
  }
  return out;
}

/** Сохраняем в БД: плеер читает `blocks`, legacy-поля очищаем, чтобы не дублировать. */
export function lessonContentFromBlocks(blocks: LessonContentBlock[]): LessonContent {
  const firstPdf = blocks.find((b): b is Extract<LessonContentBlock, { type: "pdf" }> => b.type === "pdf");
  return {
    schemaVersion: 2,
    blocks,
    presentationPdfUrl: firstPdf?.url ?? null,
    slides: [],
    practiceSteps: [],
    checkpoints: [],
    hints: []
  };
}
