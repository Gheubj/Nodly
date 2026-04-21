import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Layout, Spin } from "antd";
import {
  ArrowRightOutlined,
  BookOutlined,
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
import { apiClient } from "@/shared/api/client";
import { useHtmlDataTheme } from "@/hooks/useHtmlDataTheme";
import { useHomeSchoolAssignments } from "@/hooks/useHomeSchoolAssignments";
import { HomeSchedulePreview, type SchedulePreviewSlot } from "@/app/HomeSchedulePreview";
import { HomeUpcomingHomework } from "@/app/HomeUpcomingHomework";
import { HomeTeacherSummary } from "@/app/HomeTeacherSummary";
import { HomeSchoolStudentBanner } from "@/app/HomeSchoolStudentBanner";
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

function GreetingGlyph({ phase }: { phase: GreetingPhase }) {
  const common = { width: 36, height: 36, viewBox: "0 0 40 40", "aria-hidden": true as const };
  if (phase === "night") {
    return (
      <svg {...common}>
        <defs>
          <linearGradient id="gg-moon" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a5b4fc" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <circle cx="14" cy="14" r="5" fill="url(#gg-moon)" opacity="0.9" />
        <circle cx="22" cy="22" r="9" fill="none" stroke="url(#gg-moon)" strokeWidth="2.2" />
        <path d="M28 10l1.5 3 3.2.2-2.4 2.4.6 3.2-3-1.6-3 1.6.6-3.2-2.4-2.4 3.2-.2z" fill="#fde68a" opacity="0.85" />
      </svg>
    );
  }
  if (phase === "dawn") {
    return (
      <svg {...common}>
        <defs>
          <linearGradient id="gg-dawn" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="55%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#93c5fd" />
          </linearGradient>
        </defs>
        <path d="M4 28 Q20 8 36 28 Z" fill="url(#gg-dawn)" opacity="0.95" />
        <circle cx="28" cy="12" r="5" fill="#fef3c7" opacity="0.95" />
      </svg>
    );
  }
  if (phase === "evening") {
    return (
      <svg {...common}>
        <defs>
          <linearGradient id="gg-eve" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
        <path d="M2 30h36" stroke="url(#gg-eve)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="30" cy="10" r="6" fill="#fdba74" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <defs>
        <radialGradient id="gg-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#f59e0b" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="10" fill="url(#gg-sun)" />
      <g stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" opacity="0.85">
        <path d="M20 4v3M20 33v3M36 20h-3M7 20H4M31.5 8.5l-2 2M10.5 29.5l-2 2M31.5 31.5l-2-2M10.5 10.5l-2-2" />
      </g>
    </svg>
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
    icon: <CodeOutlined />,
    title: "Визуальное программирование",
    text: "Blockly с логикой, циклами и вызовами моделей. Старт — без классического кода."
  },
  {
    icon: <DatabaseOutlined />,
    title: "Данные и обучение",
    text: "Картинки и таблицы. Обучение и предсказания — внутри одного проекта."
  },
  {
    icon: <NodeIndexOutlined />,
    title: "Для класса и для себя",
    text: "Классы, коды и задания от учителя — или свободный self-paced режим."
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
    text: "Каталог уроков и свободные проекты в Blockly без привязки к школе.",
    hint: "Роль «Ученик» · режим «Без учителя»"
  }
];

const FEATURE_TONES = ["events", "data", "model"] as const;
const PATH_TONES = ["model", "events", "predict"] as const;

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
            Учись, собирай данные и <em>обучай модели</em>
            <br />
            в одной спокойной среде.
          </h1>

          <p className="landing-v2__lead">
            Nodly соединяет визуальное программирование и машинное обучение
            в единый поток. Без установки. Для школ, кружков и тех, кто учится сам.
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
              <CheckCircleFilled /> Blockly + ML
            </li>
            <li className="landing-v2__pill">
              <CheckCircleFilled /> Школы и кружки
            </li>
            <li className="landing-v2__pill">
              <CheckCircleFilled /> Русский язык
            </li>
          </ul>
        </section>

        <section
          className="landing-v2__features"
          id="features"
          aria-label="Возможности Nodly"
        >
          {FEATURES.map((feature, i) => (
            <article
              key={feature.title}
              className={`landing-v2__blockly-card landing-v2__blockly-card--${FEATURE_TONES[i] ?? "events"}`}
              onMouseMove={onReactiveCardMove}
            >
              <div className="landing-v2__blockly-card__icon" aria-hidden>
                {feature.icon}
              </div>
              <h3 className="landing-v2__blockly-card__title">{feature.title}</h3>
              <p className="landing-v2__blockly-card__text">{feature.text}</p>
            </article>
          ))}
        </section>

        <section className="landing-v2__paths" aria-label="Сценарии использования">
          {PATHS.map((path, i) => (
            <article
              key={path.title}
              className={`landing-v2__blockly-card landing-v2__blockly-card--${PATH_TONES[i] ?? "model"}`}
              onMouseMove={onReactiveCardMove}
            >
              <div className="landing-v2__blockly-card__chip">
                <span className="landing-v2__blockly-card__chip-icon" aria-hidden>
                  {path.icon}
                </span>
                {path.tag}
              </div>
              <h3 className="landing-v2__blockly-card__title">{path.title}</h3>
              <p className="landing-v2__blockly-card__text">{path.text}</p>
              <div className="landing-v2__blockly-card__actions">
                <Button
                  type="primary"
                  ghost
                  onClick={openAuthModal}
                  className="landing-v2__blockly-card__cta"
                >
                  Войти или зарегистрироваться
                </Button>
                <span className="landing-v2__blockly-card__hint">{path.hint}</span>
              </div>
            </article>
          ))}
        </section>

        <section
          className={`landing-v2__showcase${htmlTheme === "light" ? " landing-v2__showcase--light" : ""}`}
          onMouseMove={onReactiveCardMove}
          aria-labelledby="landing-v2-showcase-title"
        >
          <div className="landing-v2__showcase-glow" aria-hidden />
          <div className="landing-v2__showcase-inner">
            <div className="landing-v2__showcase-copy">
              <div className="landing-v2__showcase-badge">
                <ThunderboltOutlined /> Единый рабочий поток
              </div>
              <h2 id="landing-v2-showcase-title" className="landing-v2__showcase-title">
                Урок, практика и проверка — без&nbsp;переключения контекста.
              </h2>
              <p className="landing-v2__showcase-text">
                Ученики проходят урок, пробуют идею в мини-разработке и отправляют
                результат учителю. Прогресс и сдача живут вместе с проектом, а не в&nbsp;чате.
              </p>
              <div className="landing-v2__showcase-stats">
                <div className="landing-v2__stat">
                  <div className="landing-v2__stat-k">Blockly</div>
                  <div className="landing-v2__stat-v">2 уровня</div>
                </div>
                <div className="landing-v2__stat">
                  <div className="landing-v2__stat-k">Модели</div>
                  <div className="landing-v2__stat-v">KNN · SVM · RF</div>
                </div>
                <div className="landing-v2__stat">
                  <div className="landing-v2__stat-k">Классы</div>
                  <div className="landing-v2__stat-v">коды и задания</div>
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
                <div className="landing-v2__chip landing-v2__chip--blue">▶ Старт</div>
                <div className="landing-v2__chip landing-v2__chip--blue">Выбрать датасет</div>
              </div>
              <div className="landing-v2__device-row">
                <div className="landing-v2__chip landing-v2__chip--violet">Обучить модель</div>
              </div>
              <div className="landing-v2__device-row">
                <div className="landing-v2__chip landing-v2__chip--teal">Предсказать класс</div>
                <div className="landing-v2__chip landing-v2__chip--teal">Сохранить</div>
              </div>
              <NodlyPromoMetrics />
            </div>
          </div>
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

  const quickLinks: QuickLink[] = useMemo(() => {
    const links: QuickLink[] = [];
    links.push({
      to: "/studio",
      title: "Разработка",
      sub: "Blockly · модели · данные",
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
            <span className="home-v2__hello-greet">{greeting.line}</span>
          </div>
          <h1 className="home-v2__hello">{user.nickname}</h1>
          <p className="home-v2__hello-sub">
            Короткая сводка и быстрый вход в разделы. Всё, что нужно — на одном экране.
          </p>
        </header>

        <nav className="home-v2__quicklinks" aria-label="Быстрые разделы">
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
            <HomeReactiveSurface>
              <HomeTeacherSummary />
            </HomeReactiveSurface>
          ) : null}
          {schoolStudent ? (
            <HomeReactiveSurface>
              <HomeSchoolStudentWelcome
                user={user}
                summary={schoolSummary}
                summaryLoading={schoolSummaryLoading}
              />
            </HomeReactiveSurface>
          ) : null}
          {schoolStudent ? (
            <HomeReactiveSurface>
              <HomeSchoolStudentBanner
                slots={scheduleSlots}
                scheduleReady={scheduleReady}
                scheduleLoading={enrollmentsCount > 0 && !scheduleReady}
                enrollmentsCount={enrollmentsCount}
                attentionCount={schoolSummary.assignmentAttentionCount ?? 0}
                summaryLoading={schoolSummaryLoading}
              />
            </HomeReactiveSurface>
          ) : null}
          {directStudent ? (
            <HomeReactiveSurface>
              <HomeDirectStudentPanel />
            </HomeReactiveSurface>
          ) : null}

          {teacher || schoolStudent ? (
            <HomeReactiveSurface>
              <HomeSchedulePreview
                onSlotsLoaded={schoolStudent ? onScheduleSlotsLoaded : undefined}
              />
            </HomeReactiveSurface>
          ) : null}
          {schoolStudent ? (
            <HomeReactiveSurface>
              <HomeUpcomingHomework
                rows={homeHwRows}
                loading={homeHwLoading}
                onRefresh={reloadHomeHw}
              />
            </HomeReactiveSurface>
          ) : null}
        </div>
      </div>
      <LandingFooter />
    </Content>
  );
}
