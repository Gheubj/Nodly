import type { TourProps } from "antd";

export type OnboardingPersona = "teacher" | "studentSchool" | "studentDirect";

export type StepPlacement = NonNullable<NonNullable<TourProps["steps"]>[0]["placement"]>;

export type OnboardingStepDef = {
  /** When pathname does not satisfy `routeMatch`, navigate here first */
  navigateTo?: string;
  routeMatch: (pathname: string) => boolean;
  targetAttr: string;
  title: string;
  description: string;
  placement?: StepPlacement;
  prepareTeacherTab?: string;
  prepareStudentClassTab?: string;
  /** If anchor is missing (e.g. user not on /lesson/…), skip to the next step */
  optional?: boolean;
};
