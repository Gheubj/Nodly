import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Tour, type TourProps } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import type { SessionUser } from "@/store/useSessionStore";
import { getOnboardingPersona } from "@/onboarding/persona";
import { stepsForPersona } from "@/onboarding/stepDefinitions";
import { readOnboardingState, writeOnboardingState } from "@/onboarding/storage";
import { anchorSelector, waitForElement } from "@/onboarding/waitForElement";
import type { OnboardingStepDef } from "@/onboarding/types";

export const NODLY_START_ONBOARDING_EVENT = "nodly-start-onboarding";
export const NODLY_ONBOARDING_STORAGE_EVENT = "nodly-onboarding-storage-updated";

type StartDetail = { fromSettings?: boolean };

function dispatchTeacherTab(key: string) {
  window.dispatchEvent(new CustomEvent("nodly-onboarding-teacher-tab", { detail: key }));
}

function dispatchStudentClassTab(key: string) {
  window.dispatchEvent(new CustomEvent("nodly-onboarding-student-class-tab", { detail: key }));
}

type Props = {
  user: SessionUser | null;
  /** Hide global tour in lesson mini-studio embed */
  disabled?: boolean;
};

export function OnboardingTourHost({ user, disabled }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const persona = useMemo(() => getOnboardingPersona(user), [user]);
  const defs = useMemo<OnboardingStepDef[]>(() => (persona ? stepsForPersona(persona) : []), [persona]);

  const [run, setRun] = useState(false);
  const [current, setCurrent] = useState(0);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);

  const bump = useCallback(() => setTick((t) => t + 1), []);

  const finishTour = useCallback(() => {
    setOpen(false);
    setRun(false);
    setCurrent(0);
    if (user && persona) {
      writeOnboardingState(user.id, persona, { tourCompletedAt: new Date().toISOString() });
      window.dispatchEvent(new Event(NODLY_ONBOARDING_STORAGE_EVENT));
    }
  }, [user, persona]);

  const applyPrepare = useCallback((def: OnboardingStepDef) => {
    if (def.prepareTeacherTab) {
      dispatchTeacherTab(def.prepareTeacherTab);
    }
    if (def.prepareStudentClassTab) {
      dispatchStudentClassTab(def.prepareStudentClassTab);
    }
  }, []);

  const settleStep = useCallback(
    async (index: number) => {
      if (!persona || !user) {
        return;
      }
      const def = defs[index];
      if (!def) {
        finishTour();
        return;
      }
      if (def.navigateTo && !def.routeMatch(pathname)) {
        setOpen(false);
        navigate(def.navigateTo);
        return;
      }
      if (!def.routeMatch(pathname)) {
        if (def.optional) {
          setCurrent((c) => {
            const next = c + 1;
            if (next >= defs.length) {
              queueMicrotask(() => finishTour());
              return c;
            }
            return next;
          });
          bump();
          return;
        }
        setOpen(false);
        navigate(def.navigateTo ?? "/");
        return;
      }
      applyPrepare(def);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const el = await waitForElement(anchorSelector(def.targetAttr), 4500);
      if (!el && def.optional) {
        setCurrent((c) => {
          const next = c + 1;
          if (next >= defs.length) {
            queueMicrotask(() => finishTour());
            return c;
          }
          return next;
        });
        bump();
        return;
      }
      setOpen(true);
      bump();
    },
    [persona, user, defs, pathname, navigate, applyPrepare, finishTour, bump]
  );

  useLayoutEffect(() => {
    if (!run || disabled) {
      return;
    }
    void settleStep(current);
  }, [run, disabled, current, pathname, settleStep]);

  const tourSteps: TourProps["steps"] = useMemo(
    () =>
      defs.map((d, i) => ({
        title: d.title,
        description: d.description,
        placement: d.placement,
        target: () => document.querySelector(anchorSelector(d.targetAttr)) ?? document.body,
        prevButtonProps: { children: "Назад" },
        nextButtonProps: { children: i < defs.length - 1 ? "Далее" : "Готово" }
      })),
    [defs, tick]
  );

  const startTour = useCallback(() => {
    if (!persona || !user || disabled) {
      return;
    }
    setRun(true);
    setCurrent(0);
    setOpen(false);
    bump();
  }, [persona, user, disabled, bump]);

  useEffect(() => {
    const onStart = (e: Event) => {
      const ce = e as CustomEvent<StartDetail>;
      if (ce.detail?.fromSettings && user && persona) {
        writeOnboardingState(user.id, persona, { tourCompletedAt: undefined });
      }
      startTour();
    };
    window.addEventListener(NODLY_START_ONBOARDING_EVENT, onStart as EventListener);
    return () => window.removeEventListener(NODLY_START_ONBOARDING_EVENT, onStart as EventListener);
  }, [startTour, user, persona]);

  const abandonTour = useCallback(() => {
    setOpen(false);
    setRun(false);
    if (user && persona) {
      const st = readOnboardingState(user.id, persona);
      if (!st.tourCompletedAt) {
        writeOnboardingState(user.id, persona, { homePromptDismissedAt: new Date().toISOString() });
        window.dispatchEvent(new Event(NODLY_ONBOARDING_STORAGE_EVENT));
      }
    }
  }, [user, persona]);

  const onChange = useCallback(
    (next: number) => {
      if (next >= defs.length) {
        finishTour();
        return;
      }
      setOpen(false);
      setCurrent(next);
      bump();
    },
    [defs.length, finishTour, bump]
  );

  if (!persona || defs.length === 0 || disabled) {
    return null;
  }

  return (
    <Tour
      open={run && open}
      onClose={() => abandonTour()}
      onFinish={() => finishTour()}
      current={current}
      steps={tourSteps}
      onChange={onChange}
      disabledInteraction
      indicatorsRender={(cur, total) => (
        <span style={{ fontSize: 12 }}>
          {cur + 1} / {total}
        </span>
      )}
    />
  );
}
