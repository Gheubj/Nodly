import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Dropdown, Input, Select, Space, Typography, Upload, message } from "antd";
import { DeleteOutlined, DownOutlined, PlusOutlined, UpOutlined, UploadOutlined } from "@ant-design/icons";
import type { LessonContentBlock, StudioGoal } from "@/shared/types/lessonContent";
import { apiClient } from "@/shared/api/client";
import { newLessonBlockId } from "@/shared/lessonContentBlocks";
import { useSessionStore } from "@/store/useSessionStore";
import { listProjects } from "@/features/project/projectRepository";
import type { UploadProps } from "antd";

const { Text } = Typography;

const BLOCK_TYPES: { value: LessonContentBlock["type"]; label: string }[] = [
  { value: "text", label: "Текст" },
  { value: "media", label: "Медиа (картинка/PDF)" },
  { value: "studio", label: "Мини-разработка" },
  { value: "checkpoint", label: "Контрольный вопрос" },
  { value: "divider", label: "Разделитель" }
];

const STUDIO_GOAL_TYPES: Array<{ value: StudioGoal["type"]; label: string }> = [
  { value: "add_block", label: "Добавить блок" },
  { value: "select_dataset", label: "Выбрать датасет" },
  { value: "train_model", label: "Запустить обучение" },
  { value: "run_prediction", label: "Сделать предсказание" }
];

const STUDIO_BLOCK_TYPE_OPTIONS = [
  { value: "noda_start", label: "Старт" },
  { value: "noda_train_model_simple", label: "Обучить модель (уровень 1)" },
  { value: "noda_train_model", label: "Обучить модель (уровень 2+)" },
  { value: "noda_predict_l1", label: "Предсказать (уровень 1)" },
  { value: "noda_predict_class", label: "Предсказать (уровень 2+)" },
  { value: "noda_save_model", label: "Сохранить модель" }
];

function defaultBlock(type: LessonContentBlock["type"]): LessonContentBlock {
  const id = newLessonBlockId();
  switch (type) {
    case "text":
      return { id, type: "text", body: "Текст блока" };
    case "media":
      return {
        id,
        type: "media",
        kind: "image",
        url: "https://placehold.co/1200x600/png?text=Замени+URL+или+загрузи+файл",
        caption: null
      };
    case "studio":
      return {
        id,
        type: "studio",
        instruction: "",
        ctaAction: null,
        studioPracticeKind: "empty",
        studioWorkspaceLevel: 1
      };
    case "checkpoint":
      return { id, type: "checkpoint", question: "", expectedAnswer: "", answerMode: "text", options: [] };
    case "divider":
      return { id, type: "divider" };
    default:
      return { id, type: "text", body: "Блок" };
  }
}

export type AdminLessonBlockEditorProps = {
  blocks: LessonContentBlock[];
  onChange: (next: LessonContentBlock[]) => void;
};

export function AdminLessonBlockEditor({ blocks, onChange }: AdminLessonBlockEditorProps) {
  const { user } = useSessionStore();
  const [uploadBusy, setUploadBusy] = useState<Record<string, boolean>>({});
  const [projectOptions, setProjectOptions] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setProjectOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await listProjects(userId);
        if (cancelled) {
          return;
        }
        setProjectOptions(list.map((p) => ({ value: p.id, label: p.title })));
      } catch {
        if (!cancelled) {
          setProjectOptions([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const setBusy = useCallback((blockId: string, v: boolean) => {
    setUploadBusy((prev) => ({ ...prev, [blockId]: v }));
  }, []);

  const setBlock = (index: number, patch: Partial<LessonContentBlock>) => {
    const next = [...blocks];
    const cur = next[index];
    if (!cur) {
      return;
    }
    next[index] = { ...cur, ...patch } as LessonContentBlock;
    onChange(next);
  };

  const updateStudioGoal = (index: number, goalIndex: number, patch: Partial<StudioGoal>) => {
    const block = blocks[index];
    if (!block || block.type !== "studio") {
      return;
    }
    const goals = [...(block.goals ?? [])];
    const current = goals[goalIndex];
    if (!current) {
      return;
    }
    goals[goalIndex] = { ...current, ...patch } as StudioGoal;
    setBlock(index, { goals } as Partial<LessonContentBlock>);
  };

  const addStudioGoal = (index: number) => {
    const block = blocks[index];
    if (!block || block.type !== "studio") {
      return;
    }
    const goals = [...(block.goals ?? [])];
    goals.push({
      id: newLessonBlockId(),
      title: "Добавить блок «Обучить модель»",
      type: "add_block",
      blockType: "noda_train_model_simple"
    });
    setBlock(index, { goals } as Partial<LessonContentBlock>);
  };

  const removeStudioGoal = (index: number, goalIndex: number) => {
    const block = blocks[index];
    if (!block || block.type !== "studio") {
      return;
    }
    const goals = (block.goals ?? []).filter((_, i) => i !== goalIndex);
    setBlock(index, { goals } as Partial<LessonContentBlock>);
  };

  const replaceBlockType = (index: number, type: LessonContentBlock["type"]) => {
    const next = [...blocks];
    next[index] = defaultBlock(type);
    onChange(next);
  };

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= blocks.length) {
      return;
    }
    const next = [...blocks];
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(blocks.filter((_, i) => i !== index));
  };

  const insertBlockAt = (index: number, type: LessonContentBlock["type"]) => {
    const next = [...blocks];
    next.splice(index, 0, defaultBlock(type));
    onChange(next);
  };

  const uploadImageForMediaBlock = (blockId: string, index: number): UploadProps["customRequest"] => {
    return async (options) => {
      const { file, onError, onSuccess } = options;
      const blob = file as File;
      setBusy(blockId, true);
      try {
        const fd = new FormData();
        fd.append("image", blob, blob.name || "slide.png");
        const res = await apiClient.postForm<{ url: string }>("/api/admin/uploads/lesson-image", fd);
        setBlock(index, { url: res.url } as Partial<Extract<LessonContentBlock, { type: "media" }>>);
        message.success("Изображение загружено");
        onSuccess?.(res, new XMLHttpRequest());
      } catch (e) {
        message.error(e instanceof Error ? e.message : "Ошибка загрузки");
        onError?.(e instanceof Error ? e : new Error("upload"));
      } finally {
        setBusy(blockId, false);
      }
    };
  };

  const uploadPdfForMediaBlock = (blockId: string, index: number): UploadProps["customRequest"] => {
    return async (options) => {
      const { file, onError, onSuccess } = options;
      const blob = file as File;
      setBusy(blockId, true);
      try {
        const fd = new FormData();
        fd.append("pdf", blob, blob.name || "lesson.pdf");
        const res = await apiClient.postForm<{ url: string }>("/api/admin/uploads/lesson-pdf", fd);
        setBlock(index, { url: res.url } as Partial<Extract<LessonContentBlock, { type: "media" }>>);
        message.success("PDF загружен");
        onSuccess?.(res, new XMLHttpRequest());
      } catch (e) {
        message.error(e instanceof Error ? e.message : "Ошибка загрузки");
        onError?.(e instanceof Error ? e : new Error("upload"));
      } finally {
        setBusy(blockId, false);
      }
    };
  };

  const studioProjectSelectOptions = useMemo(
    () => [
      { value: "__empty__", label: "Пустая практика" },
      ...projectOptions.map((item) => ({ value: item.value, label: item.label }))
    ],
    [projectOptions]
  );

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }} className="lesson-block-editor">
      {blocks.length === 0 ? (
        <div className="lesson-block-editor__insert-row lesson-block-editor__insert-row--empty">
          <Dropdown
            menu={{
              items: BLOCK_TYPES.map((t) => ({
                key: t.value,
                label: t.label,
                onClick: () => insertBlockAt(0, t.value)
              }))
            }}
          >
            <Button type="dashed" icon={<PlusOutlined />}>
              Добавить первый блок
            </Button>
          </Dropdown>
        </div>
      ) : null}
      {blocks.map((block, index) => (
        <div key={block.id}>
          <div className="lesson-block-editor__insert-row">
            <Dropdown
              menu={{
                items: BLOCK_TYPES.map((t) => ({
                  key: t.value,
                  label: t.label,
                  onClick: () => insertBlockAt(index, t.value)
                }))
              }}
            >
              <Button size="small" type="text" icon={<PlusOutlined />}>
                Добавить блок
              </Button>
            </Dropdown>
          </div>
          <Card
            className="lesson-block-editor__card lesson-block-editor__cell"
            size="small"
            title={
              <Space wrap>
                <Text type="secondary">#{index + 1}</Text>
                <Select
                  size="small"
                  style={{ width: 200 }}
                  value={block.type}
                  options={BLOCK_TYPES}
                  onChange={(v) => replaceBlockType(index, v as LessonContentBlock["type"])}
                />
                <Button size="small" icon={<UpOutlined />} disabled={index === 0} onClick={() => move(index, -1)} />
                <Button
                  size="small"
                  icon={<DownOutlined />}
                  disabled={index === blocks.length - 1}
                  onClick={() => move(index, 1)}
                />
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(index)} />
              </Space>
            }
          >
          {block.type === "text" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input.TextArea rows={6} value={block.body} onChange={(e) => setBlock(index, { body: e.target.value })} />
            </Space>
          ) : null}
          {block.type === "media" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select
                value={block.kind}
                options={[
                  { value: "image", label: "Картинка" },
                  { value: "pdf", label: "PDF" }
                ]}
                onChange={(v) => setBlock(index, { kind: v as "image" | "pdf" })}
              />
              <Input
                placeholder={block.kind === "pdf" ? "URL PDF" : "URL картинки"}
                value={block.url}
                onChange={(e) => setBlock(index, { url: e.target.value })}
              />
              {block.kind === "pdf" ? (
                <Upload
                  accept="application/pdf,.pdf"
                  maxCount={1}
                  showUploadList={false}
                  customRequest={uploadPdfForMediaBlock(block.id, index)}
                >
                  <Button icon={<UploadOutlined />} loading={uploadBusy[block.id]}>
                    Загрузить PDF
                  </Button>
                </Upload>
              ) : (
                <Upload
                  accept="image/*"
                  maxCount={1}
                  showUploadList={false}
                  customRequest={uploadImageForMediaBlock(block.id, index)}
                >
                  <Button icon={<UploadOutlined />} loading={uploadBusy[block.id]}>
                    Загрузить картинку
                  </Button>
                </Upload>
              )}
              <Input
                placeholder={block.kind === "pdf" ? "Заголовок над презентацией" : "Подпись (необязательно)"}
                value={block.caption ?? ""}
                onChange={(e) => setBlock(index, { caption: e.target.value || null })}
              />
            </Space>
          ) : null}
          {block.type === "studio" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input.TextArea
                rows={3}
                value={block.instruction}
                onChange={(e) => setBlock(index, { instruction: e.target.value })}
              />
              <Select
                  style={{ width: "100%" }}
                  value={block.studioPracticeKind === "project_clone" && block.referenceProjectId ? block.referenceProjectId : "__empty__"}
                  options={studioProjectSelectOptions}
                  showSearch
                  optionFilterProp="label"
                  onChange={(v) => {
                    if (v === "__empty__") {
                      setBlock(index, {
                        studioPracticeKind: "empty",
                        referenceProjectId: null,
                        studioWorkspaceLevel: block.studioWorkspaceLevel ?? 1
                      });
                      return;
                    }
                    setBlock(index, {
                      studioPracticeKind: "project_clone",
                      referenceProjectId: v,
                      studioWorkspaceLevel: undefined
                    });
                  }}
                />
                <Select
                  style={{ width: "100%" }}
                  value={block.studioWorkspaceLevel ?? 1}
                  disabled={block.studioPracticeKind === "project_clone" && Boolean(block.referenceProjectId)}
                  title={block.studioPracticeKind === "project_clone" ? "Для проекта из библиотеки уровень берется из проекта" : undefined}
                  placeholder="Уровень Blockly"
                  onChange={(v) => {
                    setBlock(index, { studioWorkspaceLevel: v as 1 | 2 | 3 });
                  }}
                  options={[
                    { value: 1, label: "Уровень Blockly 1" },
                    { value: 2, label: "Уровень Blockly 2" },
                    { value: 3, label: "Уровень Blockly 3" }
                  ]}
                />
                <Card size="small" title="Цели мини-разработки">
                  <Space direction="vertical" style={{ width: "100%" }} size="small">
                    {(block.goals ?? []).map((goal, goalIndex) => (
                      <Card
                        key={goal.id}
                        size="small"
                        type="inner"
                        title={`Цель ${goalIndex + 1}`}
                        extra={
                          <Button size="small" danger onClick={() => removeStudioGoal(index, goalIndex)}>
                            Удалить
                          </Button>
                        }
                      >
                        <Space direction="vertical" style={{ width: "100%" }} size="small">
                          <Input
                            placeholder="Текст цели (что увидит ученик)"
                            value={goal.title}
                            onChange={(e) => updateStudioGoal(index, goalIndex, { title: e.target.value })}
                          />
                          <Select
                            style={{ width: "100%" }}
                            value={goal.type}
                            options={STUDIO_GOAL_TYPES}
                            onChange={(v) => {
                              const t = v as StudioGoal["type"];
                              if (t === "add_block") {
                                updateStudioGoal(index, goalIndex, {
                                  type: t,
                                  blockType: "noda_train_model_simple"
                                } as Partial<StudioGoal>);
                                return;
                              }
                              if (t === "select_dataset") {
                                updateStudioGoal(index, goalIndex, {
                                  type: t,
                                  datasetKind: "image"
                                } as Partial<StudioGoal>);
                                return;
                              }
                              updateStudioGoal(index, goalIndex, { type: t } as Partial<StudioGoal>);
                            }}
                          />
                          {goal.type === "add_block" ? (
                            <Select
                              style={{ width: "100%" }}
                              value={goal.blockType}
                              options={STUDIO_BLOCK_TYPE_OPTIONS}
                              onChange={(v) =>
                                updateStudioGoal(index, goalIndex, { blockType: String(v) } as Partial<StudioGoal>)
                              }
                            />
                          ) : null}
                          {goal.type === "select_dataset" ? (
                            <Select
                              style={{ width: "100%" }}
                              value={goal.datasetKind}
                              options={[
                                { value: "image", label: "Image датасет" },
                                { value: "tabular", label: "Tabular датасет" }
                              ]}
                              onChange={(v) =>
                                updateStudioGoal(
                                  index,
                                  goalIndex,
                                  { datasetKind: v as "image" | "tabular" } as Partial<StudioGoal>
                                )
                              }
                            />
                          ) : null}
                        </Space>
                      </Card>
                    ))}
                    <Button type="dashed" onClick={() => addStudioGoal(index)} icon={<PlusOutlined />}>
                      Добавить цель
                    </Button>
                  </Space>
                </Card>
            </Space>
          ) : null}
          {block.type === "divider" ? (
            <Space direction="vertical" style={{ width: "100%" }} size="small">
              <Text type="secondary">Горизонтальная линия между блоками в уроке у ученика.</Text>
              <hr className="lesson-block-editor__divider-preview" />
            </Space>
          ) : null}
          {block.type === "checkpoint" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input.TextArea
                rows={2}
                value={block.question}
                onChange={(e) => setBlock(index, { question: e.target.value })}
              />
              <Select
                value={block.answerMode ?? "text"}
                onChange={(v) => setBlock(index, { answerMode: v as "text" | "single" | "multi" })}
                options={[
                  { value: "text", label: "Свободный ввод" },
                  { value: "single", label: "Один вариант" },
                  { value: "multi", label: "Несколько вариантов" }
                ]}
              />
              {(block.answerMode ?? "text") !== "text" ? (
                <Input.TextArea
                  rows={3}
                  placeholder="Варианты, каждый с новой строки"
                  value={(block.options ?? []).join("\n")}
                  onChange={(e) =>
                    setBlock(index, {
                      options: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    })
                  }
                />
              ) : null}
              {(block.answerMode ?? "text") === "text" ? (
                <Input
                  placeholder="Ожидаемый ответ"
                  value={block.expectedAnswer}
                  onChange={(e) => setBlock(index, { expectedAnswer: e.target.value })}
                />
              ) : null}
              {(block.answerMode ?? "text") === "single" ? (
                <Select
                  placeholder="Правильный вариант"
                  value={block.expectedAnswer || undefined}
                  options={(block.options ?? []).map((o) => ({ value: o, label: o }))}
                  onChange={(v) => setBlock(index, { expectedAnswer: String(v) })}
                />
              ) : null}
              {(block.answerMode ?? "text") === "multi" ? (
                <Select
                  mode="multiple"
                  placeholder="Правильные варианты"
                  value={
                    block.expectedAnswer
                      ? block.expectedAnswer
                          .split("||")
                          .map((x) => x.trim())
                          .filter(Boolean)
                      : []
                  }
                  options={(block.options ?? []).map((o) => ({ value: o, label: o }))}
                  onChange={(values) => setBlock(index, { expectedAnswer: values.map(String).join("||") })}
                />
              ) : null}
            </Space>
          ) : null}
          </Card>
          {index === blocks.length - 1 ? (
            <div className="lesson-block-editor__insert-row">
              <Dropdown
                menu={{
                  items: BLOCK_TYPES.map((t) => ({
                    key: t.value,
                    label: t.label,
                    onClick: () => insertBlockAt(index + 1, t.value)
                  }))
                }}
              >
                <Button size="small" type="text" icon={<PlusOutlined />}>
                  Добавить блок
                </Button>
              </Dropdown>
            </div>
          ) : null}
        </div>
      ))}
    </Space>
  );
}