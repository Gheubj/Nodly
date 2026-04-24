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

const homeQuicklinks: OnboardingStepDef = {
  routeMatch: exact("/"),
  navigateTo: "/",
  targetAttr: "home-quicklinks",
  title: "Быстрые разделы на главной",
  description:
    "Карточки ведут сразу в Разработку, Обучение и Профиль — удобно, если не хочется искать ссылки в шапке.",
  placement: "bottom"
};

const homeSchoolWidgets: OnboardingStepDef = {
  routeMatch: exact("/"),
  navigateTo: "/",
  targetAttr: "home-school-widgets",
  title: "Сводка для школьника",
  description:
    "Кратко: на что обратить внимание, задания, дедлайны. Ниже на главной — расписание и список ДЗ; подробности всегда в разделе «Обучение».",
  placement: "top"
};

const homeTeacherSummary: OnboardingStepDef = {
  routeMatch: exact("/"),
  navigateTo: "/",
  targetAttr: "home-teacher-summary",
  title: "Сводка для учителя",
  description: "Новые ученики, сдачи на проверку и напоминания — без захода в кабинет.",
  placement: "top",
  optional: true
};

const homeScheduleWidget: OnboardingStepDef = {
  routeMatch: exact("/"),
  navigateTo: "/",
  targetAttr: "home-schedule",
  title: "Расписание на главной",
  description: "Ближайшие слоты занятий. Полный дневник с работами — во вкладке «Дневник» в разделе «Обучение».",
  placement: "top",
  optional: true
};

const homeHomeworkWidget: OnboardingStepDef = {
  routeMatch: exact("/"),
  navigateTo: "/",
  targetAttr: "home-homework",
  title: "Домашние задания на главной",
  description:
    "Список ближайших ДЗ и сроков. Статусы, фильтры и сдача — во вкладке «Все задания» в «Обучении».",
  placement: "top",
  optional: true
};

const homeDirectPanel: OnboardingStepDef = {
  routeMatch: exact("/"),
  navigateTo: "/",
  targetAttr: "home-direct-panel",
  title: "Прогресс без школы",
  description: "Кратко по модулям и урокам в самостоятельном режиме. Каталог и открытие уроков — в разделе «Обучение».",
  placement: "top"
};

const studioToolbar: OnboardingStepDef = {
  routeMatch: starts("/studio"),
  navigateTo: "/studio",
  targetAttr: "studio-toolbar",
  title: "Панель проекта",
  description:
    "Строка с названием черновика или проекта. «Сохранить» — записать в облако (первый раз откроется имя). «Данные» — датасеты, модели, входы для предсказаний. «Новый проект» — чистый черновик. «Проекты» — список, загрузить, удалить, переименовать. «Поделиться» — ссылка на копию черновика (после сохранения в облако).",
  placement: "bottom"
};

const studioBlockly: OnboardingStepDef = {
  routeMatch: starts("/studio"),
  navigateTo: "/studio",
  targetAttr: "studio-blockly",
  title: "Blockly — логика и ML",
  description:
    "Собираешь программу из блоков: события, циклы, обучение классификатора, предсказания. В уроке открывается мини-студия; здесь — полная среда с тем же проектом.",
  placement: "right"
};

const studioSidePanel: OnboardingStepDef = {
  routeMatch: starts("/studio"),
  navigateTo: "/studio",
  targetAttr: "studio-side-panel",
  title: "Правая колонка",
  description:
    "«Сцена» — превью набора данных. «Визуализация» — графики и метрики после обучения. «Персонаж» — спрайт для уроков и внешний вид.",
  placement: "left"
};

const STUDIO_ONBOARDING_STEPS: OnboardingStepDef[] = [studioToolbar, studioBlockly, studioSidePanel];

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
  homeQuicklinks,
  homeTeacherSummary,
  homeScheduleWidget,
  headerTeacher,
  headerStudio,
  headerSettings,
  headerAccount,
  teacherClasses,
  teacherAssignments,
  teacherSchedule,
  ...STUDIO_ONBOARDING_STEPS,
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
  homeQuicklinks,
  homeSchoolWidgets,
  homeScheduleWidget,
  homeHomeworkWidget,
  headerLearningSchool,
  headerStudio,
  headerSettings,
  headerAccount,
  studentClassDiary,
  studentClassCourse,
  studentClassAll,
  studentClassInfo,
  lessonPlayerFlow,
  ...STUDIO_ONBOARDING_STEPS,
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
  homeQuicklinks,
  homeDirectPanel,
  headerLearningDirect,
  directCatalog,
  lessonPlayerFlow,
  headerStudio,
  headerSettings,
  headerAccount,
  ...STUDIO_ONBOARDING_STEPS,
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
