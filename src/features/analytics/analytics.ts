import { apiClient } from "@/shared/api/client";
import { useSessionStore } from "@/store/useSessionStore";

type AnalyticsEvent = {
  name: string;
  payload?: Record<string, unknown>;
};

export async function trackEvents(events: AnalyticsEvent[]) {
  if (!useSessionStore.getState().user || events.length === 0) {
    return;
  }
  try {
    await apiClient.post("/api/analytics/events", { events });
  } catch {
    // silent fail for analytics
  }
}

export async function trackEvent(name: string, payload?: Record<string, unknown>) {
  await trackEvents([{ name, payload }]);
}

