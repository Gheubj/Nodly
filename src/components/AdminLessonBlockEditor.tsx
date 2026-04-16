import { useCallback, useState } from "react";
import { Button, Card, Dropdown, Input, Select, Space, Typography, Upload, message } from "antd";
import { DeleteOutlined, DownOutlined, PlusOutlined, UpOutlined, UploadOutlined } from "@ant-design/icons";
import type { LessonContentBlock } from "@/shared/types/lessonContent";
import { apiClient } from "@/shared/api/client";
import { newLessonBlockId } from "@/shared/lessonContentBlocks";
import type { UploadProps } from "antd";

const { Text, Paragraph } = Typography;

const BLOCK_TYPES: { value: LessonContentBlock["type"]; label: string }[] = [
  { value: "text", label: "Текст" },
  { value: "media", label: "Медиа (картинка/PDF)" },
  { value: "studio", label: "Мини-разработка" },
  { value: "checkpoint", label: "Контрольный вопрос" },
  { value: "divider", label: "Разделитель" }
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
        title: "Практика",
        instruction: "Опиши интерактивную практику внутри урока.",
        ctaAction: null,
        studioPracticeKind: "template"
      };
    case "checkpoint":
      return { id, type: "checkpoint", question: "Вопрос?", expectedAnswer: "Ответ" };
    default:
      return { id, type: "divider" };
  }
}

export type AdminLessonBlockEditorProps = {
  blocks: LessonContentBlock[];
  onChange: (next: LessonContentBlock[]) => void;
};

export function AdminLessonBlockEditor({ blocks, onChange }: AdminLessonBlockEditorProps) {
  const [uploadBusy, setUploadBusy] = useState<Record<string, boolean>>({});

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

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }} className="lesson-block-editor">
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Сверху вниз — как увидит ученик: единая colab-лента с markdown, медиа и мини-разработкой.
      </Paragraph>
      <Dropdown
        menu={{
          items: BLOCK_TYPES.map((t) => ({
            key: t.value,
            label: t.label,
            onClick: () => onChange([...blocks, defaultBlock(t.value)])
          }))
        }}
      >
        <Button type="dashed" icon={<PlusOutlined />}>
          Добавить блок…
        </Button>
      </Dropdown>
      {blocks.map((block, index) => (
        <Card
          key={block.id}
          className="lesson-block-editor__card"
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
              <Text type="secondary">Поддерживается markdown (заголовки, списки, **жирный**, ссылки, таблицы).</Text>
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
              <Input value={block.title} onChange={(e) => setBlock(index, { title: e.target.value })} />
              <Input.TextArea
                rows={3}
                value={block.instruction}
                onChange={(e) => setBlock(index, { instruction: e.target.value })}
              />
              <Input
                placeholder="Доп. действие (необязательно)"
                value={block.ctaAction ?? ""}
                onChange={(e) => setBlock(index, { ctaAction: e.target.value || null })}
              />
              <div>
                <Text type="secondary">Стартовый проект для ученика</Text>
                <Select
                  style={{ width: "100%", marginTop: 6 }}
                  value={block.studioPracticeKind ?? "template"}
                  onChange={(v) => {
                    const kind = v as "template" | "project_clone" | "empty";
                    if (kind === "template") {
                      setBlock(index, {
                        studioPracticeKind: "template",
                        referenceProjectId: null,
                        studioWorkspaceLevel: undefined
                      });
                    } else if (kind === "empty") {
                      setBlock(index, {
                        studioPracticeKind: "empty",
                        referenceProjectId: null,
                        studioWorkspaceLevel: block.studioWorkspaceLevel ?? 1
                      });
                    } else {
                      setBlock(index, {
                        studioPracticeKind: "project_clone",
                        studioWorkspaceLevel: undefined
                      });
                    }
                  }}
                  options={[
                    { value: "template", label: "Как в шаблоне урока (starterPayload в LMS)" },
                    {
                      value: "project_clone",
                      label: "Копия готового облачного проекта (создай в «Разработка», вставь id из URL)"
                    },
                    {
                      value: "empty",
                      label: "Пустая практика — только уровень Blockly (данные и блоки ученик добавит сам)"
                    }
                  ]}
                />
              </div>
              {(block.studioPracticeKind ?? "template") === "project_clone" ? (
                <Input
                  placeholder="ID проекта, например p_abc123…"
                  value={block.referenceProjectId ?? ""}
                  onChange={(e) => setBlock(index, { referenceProjectId: e.target.value.trim() || null })}
                />
              ) : null}
              {(block.studioPracticeKind ?? "template") === "empty" ? (
                <Select
                  style={{ width: "100%" }}
                  value={block.studioWorkspaceLevel ?? 1}
                  onChange={(v) => setBlock(index, { studioWorkspaceLevel: v as 1 | 2 | 3 })}
                  options={[
                    { value: 1, label: "Уровень Blockly 1 (ученик не переключает)" },
                    { value: 2, label: "Уровень Blockly 2" },
                    { value: 3, label: "Уровень Blockly 3" }
                  ]}
                />
              ) : null}
            </Space>
          ) : null}
          {block.type === "checkpoint" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input.TextArea
                rows={2}
                value={block.question}
                onChange={(e) => setBlock(index, { question: e.target.value })}
              />
              <Input
                placeholder="Ожидаемый ответ"
                value={block.expectedAnswer}
                onChange={(e) => setBlock(index, { expectedAnswer: e.target.value })}
              />
            </Space>
          ) : null}
          {block.type === "divider" ? <Text type="secondary">Разделитель между блоками</Text> : null}
        </Card>
      ))}
    </Space>
  );
}