import type { SessionUser } from "@/store/useSessionStore";
import type { OnboardingPersona } from "@/onboarding/types";

export function getOnboardingPersona(user: SessionUser | null): OnboardingPersona | null {
  if (!user) {
    return null;
  }
  if (user.role === "teacher" || user.role === "admin") {
    return "teacher";
  }
  if (user.role === "student" && user.studentMode === "school") {
    return "studentSchool";
  }
  if (user.role === "student" && user.studentMode === "direct") {
    return "studentDirect";
  }
  return null;
}
