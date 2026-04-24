import type { OnboardingPersona } from "@/onboarding/types";

export const ONBOARDING_STORAGE_VERSION = "v1";

export type OnboardingPersisted = {
  tourCompletedAt?: string;
  homePromptDismissedAt?: string;
};

function key(userId: string, persona: OnboardingPersona): string {
  return `nodly_onboarding_${ONBOARDING_STORAGE_VERSION}:${userId}:${persona}`;
}

export function readOnboardingState(userId: string, persona: OnboardingPersona): OnboardingPersisted {
  try {
    const raw = localStorage.getItem(key(userId, persona));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as OnboardingPersisted;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function writeOnboardingState(
  userId: string,
  persona: OnboardingPersona,
  patch: Partial<OnboardingPersisted>
): void {
  const prev = readOnboardingState(userId, persona);
  try {
    localStorage.setItem(key(userId, persona), JSON.stringify({ ...prev, ...patch }));
  } catch {
    /* ignore quota */
  }
}

export function clearOnboardingCompletion(userId: string, persona: OnboardingPersona): void {
  const prev = readOnboardingState(userId, persona);
  writeOnboardingState(userId, persona, {
    ...prev,
    tourCompletedAt: undefined,
    homePromptDismissedAt: undefined
  });
}
