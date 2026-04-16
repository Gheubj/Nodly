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
  { value: "image", label: "Картинка" },
  { value: "pdf", label: "PDF (в ленту)" },
  { value: "studio", label: "Практика Studio" },
  { value: "checkpoint", label: "Контрольный вопрос" },
  { value: "divider", label: "Разделитель" }
];

function defaultBlock(type: LessonContentBlock["type"]): LessonContentBlock {
  const id = newLessonBlockId();
  switch (type) {
    case "text":
      return { id, type: "text", body: "Текст блока" };
    case "image":
      return {
        id,
        type: "image",
        url: "https://placehold.co/1200x600/png?text=Замени+URL+или+загрузи+файл",
        caption: null
      };
    case "pdf":
      return { id, type: "pdf", url: "/", caption: "Презентация" };
    case "studio":
      return {
        id,
        type: "studio",
        title: "Практика",
        instruction: "Опиши, что сделать в Studio.",
        ctaAction: "open_studio"
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

  const uploadImageForBlock = (blockId: string, index: number): UploadProps["customRequest"] => {
    return async (options) => {
      const { file, onError, onSuccess } = options;
      const blob = file as File;
      setBusy(blockId, true);
      try {
        const fd = new FormData();
        fd.append("image", blob, blob.name || "slide.png");
        const res = await apiClient.postForm<{ url: string }>("/api/admin/uploads/lesson-image", fd);
        setBlock(index, { url: res.url } as Partial<Extract<LessonContentBlock, { type: "image" }>>);
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

  const uploadPdfForBlock = (blockId: string, index: number): UploadProps["customRequest"] => {
    return async (options) => {
      const { file, onError, onSuccess } = options;
      const blob = file as File;
      setBusy(blockId, true);
      try {
        const fd = new FormData();
        fd.append("pdf", blob, blob.name || "lesson.pdf");
        const res = await apiClient.postForm<{ url: string }>("/api/admin/uploads/lesson-pdf", fd);
        setBlock(index, { url: res.url } as Partial<Extract<LessonContentBlock, { type: "pdf" }>>);
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
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Сверху вниз — как увидит ученик: картинки и PDF на всю ширину, затем вопросы и кнопки Studio.
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
            <Input.TextArea rows={4} value={block.body} onChange={(e) => setBlock(index, { body: e.target.value })} />
          ) : null}
          {block.type === "image" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input
                placeholder="URL картинки"
                value={block.url}
                onChange={(e) => setBlock(index, { url: e.target.value })}
              />
              <Upload
                accept="image/*"
                maxCount={1}
                showUploadList={false}
                customRequest={uploadImageForBlock(block.id, index)}
              >
                <Button icon={<UploadOutlined />} loading={uploadBusy[block.id]}>
                  Загрузить картинку
                </Button>
              </Upload>
              <Input
                placeholder="Подпись (необязательно)"
                value={block.caption ?? ""}
                onChange={(e) => setBlock(index, { caption: e.target.value || null })}
              />
            </Space>
          ) : null}
          {block.type === "pdf" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input placeholder="URL PDF" value={block.url} onChange={(e) => setBlock(index, { url: e.target.value })} />
              <Upload
                accept="application/pdf,.pdf"
                maxCount={1}
                showUploadList={false}
                customRequest={uploadPdfForBlock(block.id, index)}
              >
                <Button icon={<UploadOutlined />} loading={uploadBusy[block.id]}>
                  Загрузить PDF
                </Button>
              </Upload>
              <Input
                placeholder="Заголовок над презентацией"
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
                placeholder="ctaAction (open_studio)"
                value={block.ctaAction ?? ""}
                onChange={(e) => setBlock(index, { ctaAction: e.target.value || null })}
              />
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