import type { NodlyProject, NodlyProjectMeta } from "@/shared/types/project";
import { apiClient } from "@/shared/api/client";
import { listProjectsByUser, loadProject, saveProject } from "@/features/project/projectStorage";
import { useSessionStore } from "@/store/useSessionStore";

function canUseCloud() {
  return Boolean(useSessionStore.getState().user?.id);
}

export async function listProjects(userId: string): Promise<NodlyProjectMeta[]> {
  if (!canUseCloud()) {
    return listProjectsByUser(userId);
  }
  const cloud = await apiClient.get<Array<{ id: string; title: string; createdAt: string; updatedAt: string }>>(
    "/api/projects"
  );
  const sessionUserId = useSessionStore.getState().user?.id ?? userId;
  return cloud.map((item) => ({
    id: item.id,
    userId: sessionUserId,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
}

export async function saveProjectSmart(project: NodlyProject) {
  if (!canUseCloud()) {
    return saveProject(project);
  }
  await apiClient.put(`/api/projects/${project.meta.id}`, {
    title: project.meta.title,
    snapshot: project.snapshot as unknown as Record<string, unknown>
  });
}

export async function loadProjectSmart(projectId: string): Promise<NodlyProject | null> {
  if (!canUseCloud()) {
    return loadProject(projectId);
  }
  return apiClient.get<NodlyProject>(`/api/projects/${projectId}`);
}

