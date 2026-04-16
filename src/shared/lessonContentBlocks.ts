import type { LessonContent, LessonContentBlock } from "@/shared/types/lessonContent";

export function newLessonBlockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeBlock(block: LessonContentBlock): LessonContentBlock {
  if (block.type === "image") {
    return {
      id: block.id,
      type: "media",
      kind: "image",
      url: block.url,
      caption: block.caption ?? null
    };
  }
  if (block.type === "pdf") {
    return {
      id: block.id,
      type: "media",
      kind: "pdf",
      url: block.url,
      caption: block.caption ?? null
    };
  }
  return block;
}

/** Если в контенте уже есть blocks — используем их; иначе собираем из legacy-полей (одна «лента»). */
export function expandLessonContentToBlocks(lc: LessonContent): LessonContentBlock[] {
  if (Array.isArray(lc.blocks)) {
    if (lc.blocks.length > 0) {
      return lc.blocks.map(normalizeBlock);
    }
    if (lc.schemaVersion === 2) {
      return [];
    }
  }
  const out: LessonContentBlock[] = [];
  if (lc.presentationPdfUrl) {
    out.push({
      id: newLessonBlockId(),
      type: "media",
      kind: "pdf",
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
      out.push({ id: newLessonBlockId(), type: "media", kind: "image", url: s.mediaUrl, caption: null });
    }
  }
  for (let i = 0; i < lc.practiceSteps.length; i++) {
    const p = lc.practiceSteps[i];
    out.push({
      id: newLessonBlockId(),
      type: "studio",
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
      expectedAnswer: c.expectedAnswer,
      answerMode: c.answerMode ?? "text",
      options: c.options ?? []
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
  const normalized = blocks.map(normalizeBlock);
  const firstPdf = normalized.find(
    (b): b is { type: "media"; kind: "pdf"; id: string; url: string; caption?: string | null } =>
      b.type === "media" && b.kind === "pdf"
  );
  return {
    schemaVersion: 2,
    blocks: normalized,
    presentationPdfUrl: firstPdf?.url ?? null,
    slides: [],
    practiceSteps: [],
    checkpoints: [],
    hints: []
  };
}
