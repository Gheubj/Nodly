import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Layout, Spin, Typography } from "antd";
import { CloudOutlined, CodeOutlined, DatabaseOutlined, RocketOutlined } from "@ant-design/icons";
import { useSessionStore } from "@/store/useSessionStore";
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
import { LandingGuestPaths } from "@/app/LandingGuestPaths";
import { LandingFooter } from "@/app/LandingFooter";

const { Content } = Layout;
const { Title, Text } = Typography;

function openAuthModal() {
  window.dispatchEvent(new Event("nodly-open-auth"));
}

export function LandingPage() {
  const { user, sessionRestored, loading: sessionLoading } = useSessionStore();
  const htmlTheme = useHtmlDataTheme();
  const schoolStudent = Boolean(user?.role === "student" && user.studentMode === "school");
  const directStudent = Boolean(user?.role === "student" && user.studentMode === "direct");
  const teacher = Boolean(user?.role === "teacher");
  const enrollmentsCount = user?.enrollments?.length ?? 0;
  const enrollmentClassroomIds =
    user?.enrollments?.map((e) => e.classroomId).sort().join(",") ?? "";

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
  }, [schoolStudent, user?.id]);

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

  const showGuestMarketing = useMemo(
    () => sessionRestored && !sessionLoading && !user,
    [sessionRestored, sessionLoading, user]
  );

  return (
    <Content className="app-content landing-page">
      <div className="landing-page__inner">
        <section
          className={`landing-hero${user && sessionRestored && !sessionLoading ? " landing-hero--authed" : ""}`}
          aria-labelledby="landing-hero-title"
        >
          <div className="landing-hero__headline">
            <img
              src={htmlTheme === "light" ? "/nodly-wordmark-outline.png" : "/nodly-wordmark-white.png"}
              alt="Nodly"
              className="landing-hero__wordmark"
              width={280}
              height={56}
              decoding="async"
            />
            <div className="landing-hero__headline-text">
              <Title level={1} id="landing-hero-title" className="landing-hero__title landing-hero__title--headline">
                ИИ и машинное обучение прямо в браузере
              </Title>
            </div>
          </div>
          {!sessionRestored || sessionLoading ? (
            <div className="landing-hero__session-placeholder">
              <Spin />
            </div>
          ) : showGuestMarketing ? (
            <>
              <p className="landing-hero__lead">
                Собирай данные, обучай модели и собирай проекты через визуальное программирование — без установки
                среды на компьютер. Один аккаунт для учеников и учителей
              </p>
              <div className="landing-hero__actions">
                <Button type="primary" size="large" icon={<RocketOutlined />} onClick={openAuthModal}>
                  Войти в аккаунт
                </Button>
                <Text type="secondary" style={{ maxWidth: 280 }}>
                  Уже есть аккаунт? Используй «Войти» в шапке или кнопку выше
                </Text>
              </div>
            </>
          ) : null}
        </section>

        {showGuestMarketing ? <LandingGuestPaths /> : null}
        {teacher ? <HomeTeacherSummary /> : null}
        {schoolStudent && user ? (
          <HomeSchoolStudentWelcome user={user} summary={schoolSummary} summaryLoading={schoolSummaryLoading} />
        ) : null}
        {schoolStudent ? (
          <HomeSchoolStudentBanner
            slots={scheduleSlots}
            scheduleReady={scheduleReady}
            scheduleLoading={enrollmentsCount > 0 && !scheduleReady}
            enrollmentsCount={enrollmentsCount}
            attentionCount={schoolSummary.assignmentAttentionCount ?? 0}
            summaryLoading={schoolSummaryLoading}
          />
        ) : null}
        {directStudent ? <HomeDirectStudentPanel /> : null}

        {user && (teacher || schoolStudent) ? (
          <HomeSchedulePreview onSlotsLoaded={schoolStudent ? onScheduleSlotsLoaded : undefined} />
        ) : null}
        {schoolStudent ? (
          <HomeUpcomingHomework rows={homeHwRows} loading={homeHwLoading} onRefresh={reloadHomeHw} />
        ) : null}

        {showGuestMarketing ? (
          <div className="landing-features" id="features" role="list">
            <Card className="landing-feature-card" bordered={false} role="listitem">
              <div className="landing-feature-card__icon">
                <CodeOutlined />
              </div>
              <div className="landing-feature-card__title">Визуальное программирование</div>
              <p className="landing-feature-card__text">
                Blockly-среда: логика, циклы и вызовы моделей без классического кода на старте
              </p>
            </Card>
            <Card className="landing-feature-card" bordered={false} role="listitem">
              <div className="landing-feature-card__icon">
                <DatabaseOutlined />
              </div>
              <div className="landing-feature-card__title">Данные и модели</div>
              <p className="landing-feature-card__text">
                Наборы изображений и таблиц, обучение и предсказания — в рамках одного проекта
              </p>
            </Card>
            <Card className="landing-feature-card" bordered={false} role="listitem">
              <div className="landing-feature-card__icon">
                <CloudOutlined />
              </div>
              <div className="landing-feature-card__title">Облако и класс</div>
              <p className="landing-feature-card__text">
                Сохранение черновиков в облаке; для школ — классы, коды и задания от учителя
              </p>
            </Card>
          </div>
        ) : null}
      </div>
      <LandingFooter />
    </Content>
  );
}
