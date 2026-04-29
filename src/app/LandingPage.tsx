import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Layout, Space, Spin } from "antd";
import {
  ArrowRightOutlined,
  BookOutlined,
  CaretRightOutlined,
  CheckCircleFilled,
  CodeOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  NodeIndexOutlined,
  RocketOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import { useSessionStore, type SessionUser } from "@/store/useSessionStore";
import {
  getOnboardingPersona,
  NODLY_ONBOARDING_STORAGE_EVENT,
  NODLY_START_ONBOARDING_EVENT,
  readOnboardingState,
  writeOnboardingState
} from "@/onboarding";
import { apiClient } from "@/shared/api/client";
import { useHtmlDataTheme } from "@/hooks/useHtmlDataTheme";
import { useHomeSchoolAssignments } from "@/hooks/useHomeSchoolAssignments";
import { HomeSchedulePreview, type SchedulePreviewSlot } from "@/app/HomeSchedulePreview";
import { HomeUpcomingHomework } from "@/app/HomeUpcomingHomework";
import { HomeTeacherSummary } from "@/app/HomeTeacherSummary";
import {
  HomeSchoolStudentBanner,
  shouldShowHomeSchoolStudentBanner
} from "@/app/HomeSchoolStudentBanner";
import {
  HomeSchoolStudentWelcome,
  type SchoolStudentSummary
} from "@/app/HomeSchoolStudentWelcome";
import { HomeDirectStudentPanel } from "@/app/HomeDirectStudentPanel";
import { LandingFooter } from "@/app/LandingFooter";
import { NodlyPromoMetrics } from "@/components/NodlyPromoMetrics";

const { Content } = Layout;

function openAuthModal() {
  window.dispatchEvent(new Event("nodly-open-auth"));
}

type GreetingPhase = "night" | "dawn" | "day" | "evening";

function greetingWithPhase(): { line: string; phase: GreetingPhase } {
  const h = new Date().getHours();
  if (h < 5) return { line: "Доброй ночи", phase: "night" };
  if (h < 10) return { line: "Доброе утро", phase: "dawn" };
  if (h < 17) return { line: "Добрый день", phase: "day" };
  if (h < 23) return { line: "Добрый вечер", phase: "evening" };
  return { line: "Доброй ночи", phase: "night" };
}

/** День / ночь в духе системных символов (☀️ / 🌙). */
function GreetingGlyph({ phase }: { phase: GreetingPhase }) {
  const glyph = phase === "night" ? "🌙" : "☀️";
  return (
    <span className="home-v2__hello-glyph-emoji" aria-hidden>
      {glyph}
    </span>
  );
}

function HomeReactiveSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="home-v2__surface" onMouseMove={onReactiveCardMove}>
      {children}
    </div>
  );
}

/** Глобальный «курсорный» слой: обновляет CSS-переменные по движению мыши (rAF). */
function useCursorScene<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    let rafId = 0;
    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        el.style.setProperty("--mx", `${x * 100}%`);
        el.style.setProperty("--my", `${y * 100}%`);
        el.style.setProperty("--tilt-x", `${(0.5 - y) * 9}deg`);
        el.style.setProperty("--tilt-y", `${(x - 0.5) * 10}deg`);
        el.style.setProperty("--par-x", `${(x - 0.5) * 22}px`);
        el.style.setProperty("--par-y", `${(y - 0.5) * 18}px`);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        el.style.setProperty("--mx", "50%");
        el.style.setProperty("--my", "30%");
        el.style.setProperty("--tilt-x", "0deg");
        el.style.setProperty("--tilt-y", "0deg");
        el.style.setProperty("--par-x", "0px");
        el.style.setProperty("--par-y", "0px");
      });
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(rafId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);
  return ref;
}

/** Локальный hover-светильник по курсору для карточек. */
function onReactiveCardMove(event: React.MouseEvent<HTMLElement>) {
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  const fx = ((event.clientX - rect.left) / rect.width) * 100;
  const fy = ((event.clientY - rect.top) / rect.height) * 100;
  target.style.setProperty("--fx", `${fx}%`);
  target.style.setProperty("--fy", `${fy}%`);
}

export function LandingPage() {
  const { user, sessionRestored, loading: sessionLoading } = useSessionStore();

  if (!sessionRestored || sessionLoading) {
    return (
      <Content className="app-content landing-boot">
        <div className="landing-boot__inner">
          <Spin />
        </div>
      </Content>
    );
  }

  if (!user) {
    return <GuestLanding />;
  }
  return <AuthedHome user={user} />;
}

/* ============================= Guest Landing ============================= */

interface Feature {
  icon: ReactNode;
  title: string;
  text: string;
}

const FEATURES: Feature[] = [
  {
    icon: <RocketOutlined />,
    title: "Не просто использовать ИИ",
    text: "Мы учим не писать промпты в чужие сервисы, а создавать и запускать собственные ML-решения."
  },
  {
    icon: <CodeOutlined />,
    title: "Мышление AI-разработчика",
    text: "От идеи и данных до обучения и проверки качества. Ученик проходит весь инженерный цикл."
  },
  {
    icon: <ExperimentOutlined />,
    title: "Понимание, что под капотом",
    text: "Регрессия, классификация, метрики и ошибки модели объясняются простым языком и сразу в практике."
  }
];

const MODULE_PLAN: Feature[] = [
  {
    icon: <BookOutlined />,
    title: "Урок 1. Введение в ИИ",
    text: "Что такое модель, зачем нужны данные и как выглядит путь AI-разработчика от задачи до результата."
  },
  {
    icon: <DatabaseOutlined />,
    title: "Урок 2. Регрессия",
    text: "Учимся предсказывать числовые значения, работать с признаками и оценивать точность модели."
  },
  {
    icon: <NodeIndexOutlined />,
    title: "Урок 3. Классификация",
    text: "Определяем классы объектов, разбираем ошибки модели и улучшаем результат на реальных примерах."
  },
  {
    icon: <ExperimentOutlined />,
    title: "Урок 4. Нейросети",
    text: "Знакомимся с базовой логикой нейросетей и собираем первый рабочий пример в визуальной среде."
  }
];

const ADVANTAGES: Feature[] = [
  {
    icon: <CodeOutlined />,
    title: "Визуальное программирование",
    text: "Понятные блоки с логикой, циклами и запуском моделей. Можно начать без классического кода."
  },
  {
    icon: <BookOutlined />,
    title: "Бесплатный модуль A",
    text: "4 урока: введение в ИИ, регрессия, классификация и нейросети. Готовый примерный план уже внутри."
  },
  {
    icon: <TeamOutlined />,
    title: "Методика уровня сборных",
    text: "Программа составлена и проверена тренерами сборной России и Испании по ИИ."
  },
  {
    icon: <DatabaseOutlined />,
    title: "Данные и обучение",
    text: "Изображения и таблицы в одном месте. Обучение, метрики и предсказания — в одном проекте."
  },
  {
    icon: <NodeIndexOutlined />,
    title: "Для класса и для себя",
    text: "Классы, коды, задания и проверка работ — или свободный self-paced режим для самостоятельного старта."
  },
  {
    icon: <RocketOutlined />,
    title: "Быстрый запуск",
    text: "Работает в браузере без установки и сложной настройки. Начать можно за пару минут."
  }
];

interface GuestPath {
  tag: string;
  icon: ReactNode;
  title: string;
  text: string;
  hint: string;
}

const PATHS: GuestPath[] = [
  {
    tag: "Учитель",
    icon: <TeamOutlined />,
    title: "Веду кружок или класс",
    text: "Создайте школу, классы и задания. Та же среда разработки, что и у детей.",
    hint: "Роль «Учитель» при регистрации"
  },
  {
    tag: "Школа",
    icon: <UserOutlined />,
    title: "Ученик в классе",
    text: "Введите код от учителя — и получите расписание, уроки и задания.",
    hint: "Роль «Ученик» · режим «Школа»"
  },
  {
    tag: "Self-paced",
    icon: <ExperimentOutlined />,
    title: "Учусь сам",
    text: "Каталог уроков и свободные проекты в визуальном программировании без привязки к школе.",
    hint: "Роль «Ученик» · режим «Без учителя»"
  }
];

function GuestLanding() {
  const htmlTheme = useHtmlDataTheme();
  const sceneRef = useCursorScene<HTMLDivElement>();
  const wordmark = htmlTheme === "light" ? "/nodly-wordmark-outline.png" : "/nodly-wordmark-white.png";

  return (
    <Content className="app-content landing-v2">
      <div className="landing-v2__scene" ref={sceneRef}>
        <div className="landing-v2__bg" aria-hidden>
          <div className="landing-v2__aurora landing-v2__aurora--a" />
          <div className="landing-v2__aurora landing-v2__aurora--b" />
          <div className="landing-v2__aurora landing-v2__aurora--c" />
          <div className="landing-v2__grid" />
          <div className="landing-v2__spotlight" />
          <div className="landing-v2__orb landing-v2__orb--one" />
          <div className="landing-v2__orb landing-v2__orb--two" />
          <div className="landing-v2__orb landing-v2__orb--three" />
          <div className="landing-v2__side-bubble landing-v2__side-bubble--l1" />
          <div className="landing-v2__side-bubble landing-v2__side-bubble--l2" />
          <div className="landing-v2__side-bubble landing-v2__side-bubble--l3" />
          <div className="landing-v2__side-bubble landing-v2__side-bubble--r1" />
          <div className="landing-v2__side-bubble landing-v2__side-bubble--r2" />
          <div className="landing-v2__side-bubble landing-v2__side-bubble--r3" />
        </div>

        <section className="landing-v2__hero" aria-labelledby="landing-v2-title">
          <div className="landing-v2__eyebrow">
            <span className="landing-v2__dot" aria-hidden />
            Новая платформа AI &amp; ML для школ и кружков
          </div>

          <div className="landing-v2__logo-plate" role="img" aria-label="Nodly">
            <span className="landing-v2__logo-glow" aria-hidden />
            <span className="landing-v2__logo-sheen" aria-hidden />
            <img src={wordmark} alt="Nodly" className="landing-v2__wordmark" draggable={false} />
          </div>

          <h1 id="landing-v2-title" className="landing-v2__title">
            Все вокруг говорят про ИИ.
            <br />
            Пора <em>учиться его разрабатывать</em>.
          </h1>

          <p className="landing-v2__lead">
            Nodly учит работать с ИИ как разработчик: проектировать решение, готовить данные,
            обучать модели и проверять качество. Не формат «конечного пользователя», а полноценный
            инженерный подход с первого занятия.
          </p>

          <div className="landing-v2__cta-row">
            <Button
              type="primary"
              size="large"
              icon={<RocketOutlined />}
              className="landing-v2__cta-primary"
              onClick={openAuthModal}
            >
              Начать бесплатно
            </Button>
            <a href="#features" className="landing-v2__cta-secondary">
              <span>Смотреть возможности</span>
              <ArrowRightOutlined />
            </a>
          </div>

          <ul className="landing-v2__pills" role="list">
            <li className="landing-v2__pill">
              <CheckCircleFilled /> Без установки
            </li>
            <li className="landing-v2__pill">
              <CheckCircleFilled /> Не пользователь ИИ, а разработчик ИИ
            </li>
            <li className="landing-v2__pill">
              <CheckCircleFilled /> Бесплатный модуль A
            </li>
            <li className="landing-v2__pill">
              <CheckCircleFilled /> 4 стартовых урока
            </li>
            <li className="landing-v2__pill">
              <CheckCircleFilled /> Школы и кружки
            </li>
            <li className="landing-v2__pill">
              <CheckCircleFilled /> Проверено тренерами сборных РФ и Испании
            </li>
          </ul>
        </section>

        <div className="landing-v2__section-intro">
          <div className="landing-v2__eyebrow">
            <span className="landing-v2__dot" aria-hidden />
            Формат обучения
          </div>
          <h2 className="landing-v2__section-title">Учимся не пользоваться ИИ, а разрабатывать ИИ</h2>
        </div>
        <section className="landing-v2__features" aria-label="Позиционирование обучения">
          {FEATURES.map((feature) => (
            <article
              key={feature.title}
              className="landing-v2__feature"
              onMouseMove={onReactiveCardMove}
            >
              <div className="landing-v2__feature-icon" aria-hidden>
                {feature.icon}
              </div>
              <h3 className="landing-v2__feature-title">{feature.title}</h3>
              <p className="landing-v2__feature-text">{feature.text}</p>
            </article>
          ))}
        </section>

        <div className="landing-v2__section-intro">
          <div className="landing-v2__eyebrow">
            <span className="landing-v2__dot" aria-hidden />
            Бесплатный старт
          </div>
          <h2 className="landing-v2__section-title">Модуль A: 4 урока с понятной траекторией</h2>
        </div>
        <section className="landing-v2__features landing-v2__features--four" aria-label="План модуля A">
          {MODULE_PLAN.map((feature) => (
            <article
              key={feature.title}
              className="landing-v2__feature"
              onMouseMove={onReactiveCardMove}
            >
              <div className="landing-v2__feature-icon" aria-hidden>
                {feature.icon}
              </div>
              <h3 className="landing-v2__feature-title">{feature.title}</h3>
              <p className="landing-v2__feature-text">{feature.text}</p>
            </article>
          ))}
        </section>

        <div className="landing-v2__section-intro" id="features">
          <div className="landing-v2__eyebrow">
            <span className="landing-v2__dot" aria-hidden />
            Преимущества Nodly
          </div>
          <h2 className="landing-v2__section-title">Максимум пользы для учеников, родителей и преподавателей</h2>
        </div>
        <section
          className="landing-v2__features"
          aria-label="Возможности Nodly"
        >
          {ADVANTAGES.map((feature) => (
            <article
              key={feature.title}
              className="landing-v2__feature"
              onMouseMove={onReactiveCardMove}
            >
              <div className="landing-v2__feature-icon" aria-hidden>
                {feature.icon}
              </div>
              <h3 className="landing-v2__feature-title">{feature.title}</h3>
              <p className="landing-v2__feature-text">{feature.text}</p>
            </article>
          ))}
        </section>

        <div className="landing-v2__section-intro">
          <div className="landing-v2__eyebrow">
            <span className="landing-v2__dot" aria-hidden />
            Как проходит обучение
          </div>
          <h2 className="landing-v2__section-title">Один экран, полный цикл AI-разработки</h2>
        </div>
        <section
          className={`landing-v2__showcase landing-v2__showcase--integrated${htmlTheme === "light" ? " landing-v2__showcase--light" : ""}`}
          onMouseMove={onReactiveCardMove}
          aria-labelledby="landing-v2-showcase-title"
        >
          <div className="landing-v2__showcase-glow" aria-hidden />
          <div className="landing-v2__showcase-inner">
            <div className="landing-v2__showcase-copy">
              <div className="landing-v2__showcase-badge">
                <ThunderboltOutlined /> Формат «от идеи до результата»
              </div>
              <h2 id="landing-v2-showcase-title" className="landing-v2__showcase-title">
                Теория, практика и проверка объединены в один рабочий процесс.
              </h2>
              <p className="landing-v2__showcase-text">
                Ученик не переключается между десятком сервисов: получает задачу, собирает
                решение, обучает модель, анализирует метрики и отправляет результат на проверку.
              </p>
              <ul className="landing-v2__showcase-flow" role="list">
                <li>1) Разбор задачи и логики модели</li>
                <li>2) Практика в визуальном программировании</li>
                <li>3) Обучение модели и анализ графиков</li>
                <li>4) Сдача работы и обратная связь</li>
              </ul>
              <div className="landing-v2__showcase-stats">
                <div className="landing-v2__stat">
                  <div className="landing-v2__stat-k">Формат</div>
                  <div className="landing-v2__stat-v">Путь AI-разработчика</div>
                </div>
                <div className="landing-v2__stat">
                  <div className="landing-v2__stat-k">Бесплатный старт</div>
                  <div className="landing-v2__stat-v">Модуль A · 4 урока</div>
                </div>
                <div className="landing-v2__stat">
                  <div className="landing-v2__stat-k">Экспертиза</div>
                  <div className="landing-v2__stat-v">Тренеры РФ и Испании</div>
                </div>
              </div>
            </div>
            <div className="landing-v2__device" aria-hidden>
              <div className="landing-v2__device-rail">
                <span className="landing-v2__device-dot" />
                <span className="landing-v2__device-dot" />
                <span className="landing-v2__device-dot" />
                <span className="landing-v2__device-title">mini-studio · iris</span>
              </div>
              <div className="landing-v2__device-row">
                <div className="landing-v2__palette-block landing-v2__palette-block--events">
                  <CaretRightOutlined className="landing-v2__palette-block__play" aria-hidden />
                  Старт
                </div>
                <div className="landing-v2__palette-block landing-v2__palette-block--data">Выбрать датасет</div>
              </div>
              <div className="landing-v2__device-row landing-v2__device-row--full">
                <div className="landing-v2__palette-block landing-v2__palette-block--model">Обучить модель</div>
              </div>
              <div className="landing-v2__device-row">
                <div className="landing-v2__palette-block landing-v2__palette-block--predict">Предсказать класс</div>
                <div className="landing-v2__palette-block landing-v2__palette-block--output">Сохранить</div>
              </div>
              <NodlyPromoMetrics />
            </div>
          </div>
        </section>

        <section className="landing-v2__paths" aria-label="Сценарии использования">
          {PATHS.map((path) => (
            <article
              key={path.title}
              className="landing-v2__path"
              onMouseMove={onReactiveCardMove}
            >
              <div className="landing-v2__path-tag">
                <span className="landing-v2__path-tag-icon" aria-hidden>
                  {path.icon}
                </span>
                {path.tag}
              </div>
              <h3 className="landing-v2__path-title">{path.title}</h3>
              <p className="landing-v2__path-text">{path.text}</p>
              <div className="landing-v2__path-actions">
                <Button type="primary" ghost onClick={openAuthModal} className="landing-v2__path-cta">
                  Войти или зарегистрироваться
                </Button>
                <span className="landing-v2__path-hint">{path.hint}</span>
              </div>
            </article>
          ))}
        </section>
      </div>
      <LandingFooter />
    </Content>
  );
}

/* ============================= Authed Home ============================= */

interface QuickLink {
  to: string;
  title: string;
  sub: string;
  icon: ReactNode;
}

function AuthedHome({ user }: { user: SessionUser }) {
  const onboardingPersona = getOnboardingPersona(user);
  const [onboardingStorageEpoch, setOnboardingStorageEpoch] = useState(0);

  useEffect(() => {
    const bump = () => setOnboardingStorageEpoch((n) => n + 1);
    window.addEventListener(NODLY_ONBOARDING_STORAGE_EVENT, bump);
    return () => window.removeEventListener(NODLY_ONBOARDING_STORAGE_EVENT, bump);
  }, []);

  const onboardingBannerVisible = useMemo(() => {
    if (!onboardingPersona) {
      return false;
    }
    const s = readOnboardingState(user.id, onboardingPersona);
    return !s.tourCompletedAt && !s.homePromptDismissedAt;
  }, [user.id, onboardingPersona, onboardingStorageEpoch]);

  const schoolStudent = user.role === "student" && user.studentMode === "school";
  const directStudent = user.role === "student" && user.studentMode === "direct";
  const teacher = user.role === "teacher";
  const admin = user.role === "admin";
  const enrollmentsCount = user.enrollments?.length ?? 0;
  const enrollmentClassroomIds =
    user.enrollments?.map((e) => e.classroomId).sort().join(",") ?? "";

  const { rows: homeHwRows, loading: homeHwLoading, reload: reloadHomeHw } =
    useHomeSchoolAssignments(schoolStudent);

  const [scheduleSlots, setScheduleSlots] = useState<SchedulePreviewSlot[]>([]);
  const [scheduleReady, setScheduleReady] = useState(false);
  const [schoolSummaryLoading, setSchoolSummaryLoading] = useState(false);
  const [schoolSummary, setSchoolSummary] = useState<SchoolStudentSummary>({});
  const prevEnrollmentClassroomIds = useRef<string | null>(null);

  useEffect(() => {
    if (!schoolStudent) {
      setScheduleSlots([]);
      setScheduleReady(false);
      setSchoolSummary({});
      setSchoolSummaryLoading(false);
      return;
    }
    let cancelled = false;
    setSchoolSummaryLoading(true);
    void (async () => {
      try {
        const s = await apiClient.get<SchoolStudentSummary>("/api/me/summary");
        if (!cancelled) {
          setSchoolSummary(s);
        }
      } catch {
        if (!cancelled) {
          setSchoolSummary({});
        }
      } finally {
        if (!cancelled) {
          setSchoolSummaryLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolStudent, user.id]);

  const onScheduleSlotsLoaded = useCallback((slots: SchedulePreviewSlot[]) => {
    setScheduleSlots(slots);
    setScheduleReady(true);
  }, []);

  useEffect(() => {
    if (!schoolStudent) {
      prevEnrollmentClassroomIds.current = null;
      return;
    }
    if (prevEnrollmentClassroomIds.current === null) {
      prevEnrollmentClassroomIds.current = enrollmentClassroomIds;
      return;
    }
    if (prevEnrollmentClassroomIds.current !== enrollmentClassroomIds) {
      prevEnrollmentClassroomIds.current = enrollmentClassroomIds;
      setScheduleReady(false);
    }
  }, [schoolStudent, enrollmentClassroomIds]);

  const greeting = useMemo(() => greetingWithPhase(), []);

  const schoolBannerProps = useMemo(
    () => ({
      slots: scheduleSlots,
      scheduleReady,
      scheduleLoading: enrollmentsCount > 0 && !scheduleReady,
      enrollmentsCount,
      attentionCount: schoolSummary.assignmentAttentionCount ?? 0,
      summaryLoading: schoolSummaryLoading
    }),
    [
      scheduleSlots,
      scheduleReady,
      enrollmentsCount,
      schoolSummary.assignmentAttentionCount,
      schoolSummaryLoading
    ]
  );

  const quickLinks: QuickLink[] = useMemo(() => {
    const links: QuickLink[] = [];
    links.push({
      to: "/studio",
      title: "Разработка",
      sub: "Визуальное программирование · модели · данные",
      icon: <CodeOutlined />
    });
    if (schoolStudent) {
      links.push({
        to: "/class",
        title: "Обучение",
        sub: "Уроки и задания от учителя",
        icon: <BookOutlined />
      });
    } else if (directStudent) {
      links.push({
        to: "/learning",
        title: "Обучение",
        sub: "Каталог уроков и практика",
        icon: <BookOutlined />
      });
    }
    if (teacher || admin) {
      links.push({
        to: "/teacher",
        title: admin ? "Админ" : "Кабинет учителя",
        sub: admin ? "Управление платформой" : "Проверки и классы",
        icon: <TeamOutlined />
      });
    }
    links.push({
      to: "/account",
      title: "Профиль",
      sub: "Аккаунт и безопасность",
      icon: <UserOutlined />
    });
    return links;
  }, [schoolStudent, directStudent, teacher, admin]);

  return (
    <Content className="app-content home-v2">
      <div className="home-v2__bg" aria-hidden>
        <div className="home-v2__aurora home-v2__aurora--a" />
        <div className="home-v2__aurora home-v2__aurora--b" />
      </div>
      <div className="home-v2__inner">
        <header className="home-v2__hero home-v2__surface" onMouseMove={onReactiveCardMove}>
          <div className="home-v2__hello-lead">
            <span className="home-v2__hello-glyph">
              <GreetingGlyph phase={greeting.phase} />
            </span>
            <span className="home-v2__hello-greet">
              {greeting.line},
            </span>
          </div>
          <h1 className="home-v2__hello">{user.nickname}</h1>
          <p className="home-v2__hello-sub">
            Короткая сводка и быстрый вход в разделы.&nbsp;Всё, что нужно — на одном экране.
          </p>
        </header>

        {onboardingPersona && onboardingBannerVisible ? (
          <Alert
            className="home-v2__onboarding-prompt"
            type="info"
            showIcon
            closable
            message="Краткая экскурсия по платформе"
            description="Покажем основные разделы с подсветкой — можно закрыть в любой момент."
            action={
              <Space direction="vertical" size="small">
                <Button
                  type="primary"
                  size="small"
                  onClick={() => {
                    if (onboardingPersona) {
                      writeOnboardingState(user.id, onboardingPersona, {
                        homePromptDismissedAt: new Date().toISOString()
                      });
                      window.dispatchEvent(new Event(NODLY_ONBOARDING_STORAGE_EVENT));
                    }
                    window.dispatchEvent(new CustomEvent(NODLY_START_ONBOARDING_EVENT, { detail: {} }));
                  }}
                >
                  Начать
                </Button>
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    if (onboardingPersona) {
                      writeOnboardingState(user.id, onboardingPersona, {
                        homePromptDismissedAt: new Date().toISOString()
                      });
                      window.dispatchEvent(new Event(NODLY_ONBOARDING_STORAGE_EVENT));
                    }
                  }}
                >
                  Не сейчас
                </Button>
              </Space>
            }
            onClose={() => {
              if (onboardingPersona) {
                writeOnboardingState(user.id, onboardingPersona, {
                  homePromptDismissedAt: new Date().toISOString()
                });
                window.dispatchEvent(new Event(NODLY_ONBOARDING_STORAGE_EVENT));
              }
            }}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <nav className="home-v2__quicklinks" aria-label="Быстрые разделы" data-onboarding="home-quicklinks">
          {quickLinks.map((ql) => (
            <Link
              key={ql.to}
              to={ql.to}
              className="home-v2__ql"
              onMouseMove={onReactiveCardMove}
            >
              <span className="home-v2__ql-icon" aria-hidden>
                {ql.icon}
              </span>
              <span className="home-v2__ql-text">
                <span className="home-v2__ql-title">{ql.title}</span>
                <span className="home-v2__ql-sub">{ql.sub}</span>
              </span>
              <ArrowRightOutlined className="home-v2__ql-arrow" aria-hidden />
            </Link>
          ))}
        </nav>

        <div className="home-v2__widgets">
          {teacher ? (
            <div data-onboarding="home-teacher-summary">
              <HomeReactiveSurface>
                <HomeTeacherSummary />
              </HomeReactiveSurface>
            </div>
          ) : null}
          {schoolStudent ? (
            <div data-onboarding="home-school-widgets">
              <HomeReactiveSurface>
                <HomeSchoolStudentWelcome
                  user={user}
                  summary={schoolSummary}
                  summaryLoading={schoolSummaryLoading}
                />
              </HomeReactiveSurface>
              {shouldShowHomeSchoolStudentBanner(schoolBannerProps) ? (
                <HomeReactiveSurface>
                  <HomeSchoolStudentBanner {...schoolBannerProps} />
                </HomeReactiveSurface>
              ) : null}
            </div>
          ) : null}
          {directStudent ? (
            <div data-onboarding="home-direct-panel">
              <HomeReactiveSurface>
                <HomeDirectStudentPanel />
              </HomeReactiveSurface>
            </div>
          ) : null}

          {teacher || schoolStudent ? (
            <div data-onboarding="home-schedule">
              <HomeReactiveSurface>
                <HomeSchedulePreview
                  onSlotsLoaded={schoolStudent ? onScheduleSlotsLoaded : undefined}
                />
              </HomeReactiveSurface>
            </div>
          ) : null}
          {schoolStudent ? (
            <div data-onboarding="home-homework">
              <HomeReactiveSurface>
                <HomeUpcomingHomework
                  rows={homeHwRows}
                  loading={homeHwLoading}
                  onRefresh={reloadHomeHw}
                />
              </HomeReactiveSurface>
            </div>
          ) : null}
        </div>
      </div>
      <LandingFooter />
    </Content>
  );
}
