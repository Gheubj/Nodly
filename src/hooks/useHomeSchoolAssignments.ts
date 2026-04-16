import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/shared/api/client";

/** Совпадает с ответом GET /api/student/assignments и SlotStudentAssignmentRow */
export type HomeSchoolAssignmentRow = {
  assignmentId: string;
  classroomId: string;
  classroomTitle: string;
  schoolName: string;
  title: string;
  kind: string;
  dueAt: string | null;
  maxScore: number;
  scheduleSlotId: string | null;
  lessonTemplateId: string | null;
  submission: {
    id: string;
    status: string;
    score: number | null;
    projectId: string | null;
    gradedSeenAt: string | null;
    teacherNote: string | null;
    revisionNote: string | null;
  } | null;
};

export function useHomeSchoolAssignments(enabled: boolean) {
  const [rows, setRows] = useState<HomeSchoolAssignmentRow[]>([]);
  const [loading, setLoading] = useState(() => Boolean(enabled));

  const reload = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setLoading(true);
    try {
      const list = await apiClient.get<HomeSchoolAssignmentRow[]>("/api/student/assignments");
      setRows(list);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    void reload();
  }, [enabled, reload]);

  return { rows, loading, reload };
}
