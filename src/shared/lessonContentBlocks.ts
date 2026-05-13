import type {
  LessonContent,
  LessonContentBlock,
  LessonContentDeck,
  LessonDeckElement,
  LessonDeckInnerBlock,
  LessonDeckSlide
} from "@/shared/types/lessonContent";

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

export function lessonHasRenderableDeck(lc: LessonContent | null | undefined): boolean {
  const deck = lc?.deck;
  if (!deck?.slides?.length) {
    return false;
  }
  return deck.slides.some((s) => s.elements.length > 0);
}

export function newDeckSlideWithPlaceholder(): LessonDeckSlide {
  const bid = newLessonBlockId();
  return {
    id: newLessonBlockId(),
    elements: [
      {
        id: newLessonBlockId(),
        layout: { x: 8, y: 10, w: 84, h: 16 },
        zIndex: 0,
        block: { id: bid, type: "text", body: "Текст слайда" }
      }
    ]
  };
}

export function emptyLessonContentDeck(): LessonContentDeck {
  return { schemaVersion: 1, slides: [newDeckSlideWithPlaceholder()] };
}

export function linearBlocksToDeck(blocks: LessonContentBlock[]): LessonContentDeck {
  const usable = blocks.filter((b) => b.type !== "divider") as LessonDeckInnerBlock[];
  if (usable.length === 0) {
    return emptyLessonContentDeck();
  }
  const slides: LessonDeckSlide[] = [];
  const CHUNK = 6;
  for (let i = 0; i < usable.length; i += CHUNK) {
    const chunk = usable.slice(i, i + CHUNK);
    const n = chunk.length;
    const gap = 2;
    const h = Math.max(10, Math.min(26, (88 - gap * (n - 1)) / Math.max(1, n)));
    let y = 6;
    const elements: LessonDeckElement[] = chunk.map((block) => {
      const el: LessonDeckElement = {
        id: newLessonBlockId(),
        layout: { x: 6, y, w: 88, h },
        zIndex: 0,
        block
      };
      y += h + gap;
      return el;
    });
    slides.push({ id: newLessonBlockId(), elements });
  }
  return { schemaVersion: 1, slides };
}

/** Плоский список блоков в порядке слайдов (сверху вниз) и элементов (zIndex, затем id). */
export function flattenDeckToBlocks(deck: LessonContentDeck): LessonContentBlock[] {
  const out: LessonContentBlock[] = [];
  for (const slide of deck.slides) {
    const sorted = [...slide.elements].sort((a, b) => {
      const za = a.zIndex ?? 0;
      const zb = b.zIndex ?? 0;
      if (za !== zb) {
        return za - zb;
      }
      return a.id.localeCompare(b.id);
    });
    for (const el of sorted) {
      out.push(normalizeBlock(el.block));
    }
  }
  return out;
}

/** Сохранение режима слайдов: дублируем `blocks` для серверных сводок и чекпоинтов. */
export function lessonContentFromDeck(deck: LessonContentDeck): LessonContent {
  const normalized = flattenDeckToBlocks(deck).map(normalizeBlock);
  const firstPdf = normalized.find(
    (b): b is { type: "media"; kind: "pdf"; id: string; url: string; caption?: string | null } =>
      b.type === "media" && b.kind === "pdf"
  );
  return {
    schemaVersion: 2,
    deck,
    blocks: normalized,
    presentationPdfUrl: firstPdf?.url ?? null,
    slides: [],
    practiceSteps: [],
    checkpoints: [],
    hints: []
  };
}

/** Если в контенте уже есть blocks — используем их; иначе собираем из legacy-полей (одна «лента»). */
export function expandLessonContentToBlocks(lc: LessonContent): LessonContentBlock[] {
  if (lessonHasRenderableDeck(lc)) {
    return flattenDeckToBlocks(lc.deck!).map(normalizeBlock);
  }
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

/** Сохраняем в БД: плеер читает `blocks`, legacy-поля очищаем, чтобы не дублировать. Режим «лента» — без `deck`. */
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
