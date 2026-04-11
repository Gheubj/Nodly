import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "antd";
import { apiClient } from "@/shared/api/client";
import type { NodlyProjectSnapshot } from "@/shared/types/project";

function randomProjectId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `p_${hex}`;
}

export type LessonTemplateListItem = {
  id: string;
  title: string;
  description: string | null;
  moduleKey: string;
  sortOrder: number;
};

export function useOpenLessonTemplate() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [openingId, setOpeningId] = useState<string | null>(null);

  const openTemplate = useCallback(
    async (t: LessonTemplateListItem) => {
      setOpeningId(t.id);
      try {
        const { starterPayload } = await apiClient.get<{ starterPayload: NodlyProjectSnapshot }>(
          `/api/lesson-templates/${t.id}/starter`
        );
        const projectId = randomProjectId();
        await apiClient.put(`/api/projects/${projectId}`, {
          title: t.title,
          snapshot: starterPayload as unknown as Record<string, unknown>
        });
        navigate(`/studio?project=${encodeURIComponent(projectId)}`);
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : "Не удалось открыть урок");
      } finally {
        setOpeningId(null);
      }
    },
    [navigate, messageApi]
  );

  return { openTemplate, openingId, contextHolder };
}
