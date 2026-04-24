import type { OnboardingPersona, OnboardingStepDef } from "@/onboarding/types";

const exact = (path: string) => (p: string) => p === path;
const starts = (prefix: string) => (p: string) => p === prefix || p.startsWith(`${prefix}/`);

const headerHome: OnboardingStepDef = {
  routeMatch: exact("/"),
  navigateTo: "/",
  targetAttr: "header-home",
  title: "Главная",
  description: "Сводка и быстрые ссылки на разделы. Сюда можно вернуться в любой момент.",
  placement: "bottom"
};

const headerStudio: OnboardingStepDef = {
  routeMatch: (p) => p === "/" || p.startsWith("/studio"),
  navigateTo: "/",
  targetAttr: "header-studio",
  title: "Разработка",
  description:
    "Blockly, датасеты и модели в одном проекте. Учителя и ученики работают в той же среде — задания и проверки стыкуются с проектом.",
  placement: "bottom"
};

const headerSettings: OnboardingStepDef = {
  routeMatch: (p) => p === "/" || p.startsWith("/studio") || p.startsWith("/teacher") || p.startsWith("/class") || p.startsWith("/learning") || p.startsWith("/account"),
  navigateTo: "/",
  targetAttr: "header-settings",
  title: "Настройки",
  description: "Тема оформления и служебные действия. Повторить экскурсию можно отсюда.",
  placement: "bottom"
};

const headerAccount: OnboardingStepDef = {
  routeMatch: (p) => p === "/" || p.startsWith("/studio") || p.startsWith("/teacher") || p.startsWith("/class") || p.startsWith("/learning") || p.startsWith("/account"),
  navigateTo: "/",
  targetAttr: "header-account",
  title: "Личный кабинет",
  description: "Ник, email, режим ученика, код класса и безопасность аккаунта.",
  placement: "bottom"
};

const studioWorkbench: OnboardingStepDef = {
  routeMatch: starts("/studio"),
  navigateTo: "/studio",
  targetAttr: "studio-workbench",
  title: "Среда разработки",
  description:
    "Сохранение в облако, данные, список проектов и Blockly. Из урока мини-студия открывается здесь же — в полном окне.",
  placement: "right"
};

const accountProfile: OnboardingStepDef = {
  routeMatch: starts("/account"),
  navigateTo: "/account",
  targetAttr: "account-profile",
  title: "Профиль",
  description: "Ник и выход из аккаунта. Для школьников — присоединение к классу по коду.",
  placement: "bottom"
};

/* --- Teacher --- */

const headerTeacher: OnboardingStepDef = {
  routeMatch: (p) => p === "/" || p.startsWith("/teacher"),
  navigateTo: "/",
  targetAttr: "header-teacher",
  title: "Кабинет учителя",
  description:
    "Школы, классы, коды для учеников, задания, расписание и журнал. Счётчики подсказывают новые сдачи и заявки в класс.",
  placement: "bottom"
};

const teacherClasses: OnboardingStepDef = {
  routeMatch: starts("/teacher"),
  navigateTo: "/teacher",
  targetAttr: "teacher-classes",
  title: "Классы и ученики",
  description: "Создай организацию и класс, скопируй код — ученик вводит его в личном кабинете.",
  placement: "top",
  prepareTeacherTab: "classes",
  optional: true
};

const teacherAssignments: OnboardingStepDef = {
  routeMatch: starts("/teacher"),
  navigateTo: "/teacher",
  targetAttr: "teacher-assignments",
  title: "Задания и проверка",
  description: "Публикация работ, сроки, автопроверки и ручная оценка. Отсюда же открывается работа ученика в плеере.",
  placement: "top",
  prepareTeacherTab: "assignments",
  optional: true
};

const teacherSchedule: OnboardingStepDef = {
  routeMatch: starts("/teacher"),
  navigateTo: "/teacher",
  targetAttr: "teacher-schedule",
  title: "Расписание",
  description: "Слоты занятий и привязка уроков к занятию — ученики видят это в своём дневнике.",
  placement: "top",
  prepareTeacherTab: "schedule",
  optional: true
};

export const TEACHER_ONBOARDING_STEPS: OnboardingStepDef[] = [
  headerHome,
  headerTeacher,
  headerStudio,
  headerSettings,
  headerAccount,
  teacherClasses,
  teacherAssignments,
  teacherSchedule,
  studioWorkbench,
  accountProfile
];

/* --- School student --- */

const headerLearningSchool: OnboardingStepDef = {
  routeMatch: (p) => p === "/" || p.startsWith("/class"),
  navigateTo: "/",
  targetAttr: "header-learning",
  title: "Обучение",
  description: "Расписание, задания и курс выбранного класса. Бейдж напомнит о важных обновлениях.",
  placement: "bottom"
};

const studentClassDiary: OnboardingStepDef = {
  routeMatch: starts("/class"),
  navigateTo: "/class",
  targetAttr: "student-class-diary",
  title: "Дневник",
  description: "Неделя слотами: на занятии и дома — работы и дедлайны. Отсюда открываешь урок и сдаёшь работу.",
  placement: "top",
  prepareStudentClassTab: "diary",
  optional: true
};

const studentClassCourse: OnboardingStepDef = {
  routeMatch: starts("/class"),
  navigateTo: "/class",
  targetAttr: "student-class-course",
  title: "Курс",
  description: "План уроков по модулю: что уже прошли на занятиях, видно по галочкам.",
  placement: "top",
  prepareStudentClassTab: "course",
  optional: true
};

const studentClassAll: OnboardingStepDef = {
  routeMatch: starts("/class"),
  navigateTo: "/class",
  targetAttr: "student-class-all-assignments",
  title: "Все задания",
  description: "Полный список с фильтрами: оценки, тип работы, просрочка по ДЗ.",
  placement: "top",
  prepareStudentClassTab: "all",
  optional: true
};

const studentClassInfo: OnboardingStepDef = {
  routeMatch: starts("/class"),
  navigateTo: "/class",
  targetAttr: "student-class-info",
  title: "Мой класс",
  description: "Школа, учитель и код класса — можно переслать однокласснику.",
  placement: "top",
  prepareStudentClassTab: "info",
  optional: true
};

const accountJoinSchool: OnboardingStepDef = {
  routeMatch: starts("/account"),
  navigateTo: "/account",
  targetAttr: "account-join-class",
  title: "Код класса",
  description: "Если ещё не в классе — введи код от учителя здесь.",
  placement: "top"
};

const lessonPlayerFlow: OnboardingStepDef = {
  routeMatch: starts("/lesson"),
  targetAttr: "lesson-player-flow",
  title: "Плеер урока",
  description:
    "Лента блоков: текст, вопросы и мини-разработка. Прогресс сохраняется; для школьного задания здесь же сдача учителю.",
  placement: "top",
  optional: true
};

export const STUDENT_SCHOOL_ONBOARDING_STEPS: OnboardingStepDef[] = [
  headerHome,
  headerLearningSchool,
  headerStudio,
  headerSettings,
  headerAccount,
  studentClassDiary,
  studentClassCourse,
  studentClassAll,
  studentClassInfo,
  lessonPlayerFlow,
  studioWorkbench,
  accountProfile,
  accountJoinSchool
];

/* --- Direct student --- */

const headerLearningDirect: OnboardingStepDef = {
  routeMatch: (p) => p === "/" || p.startsWith("/learning"),
  navigateTo: "/",
  targetAttr: "header-learning",
  title: "Обучение",
  description: "Каталог уроков и прогресс по блокам без привязки к школе.",
  placement: "bottom"
};

const directCatalog: OnboardingStepDef = {
  routeMatch: starts("/learning"),
  navigateTo: "/learning",
  targetAttr: "direct-learning-catalog",
  title: "Каталог уроков",
  description: "Выбери урок, читай краткое описание и открывай интерактивный плеер. Блоки курса открываются по порогу баллов.",
  placement: "top"
};

export const STUDENT_DIRECT_ONBOARDING_STEPS: OnboardingStepDef[] = [
  headerHome,
  headerLearningDirect,
  directCatalog,
  lessonPlayerFlow,
  headerStudio,
  headerSettings,
  headerAccount,
  studioWorkbench,
  accountProfile
];

export function stepsForPersona(persona: OnboardingPersona): OnboardingStepDef[] {
  switch (persona) {
    case "teacher":
      return TEACHER_ONBOARDING_STEPS;
    case "studentSchool":
      return STUDENT_SCHOOL_ONBOARDING_STEPS;
    case "studentDirect":
      return STUDENT_DIRECT_ONBOARDING_STEPS;
    default:
      return [];
  }
}
