// Owns the onboarding experience: the anchor registry the spotlight measures
// against, the tour state machine, the auto-start decision for new users, and
// the one-time tips. Mounted once at the top of the root layout, so its overlay
// covers the whole window; it only ever runs for signed-in users on tab
// screens, never during a recording and never over a recovery notice.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { AccessibilityInfo } from "react-native";
import { usePathname, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  autoTour,
  stepsForUser,
  tipsForScreen,
  TOUR_VERSION,
  tourSteps,
  type Tip,
  type TourStep,
} from "@/lib/onboarding";
import {
  clearMemory,
  EMPTY_STORED,
  loadState,
  markTipSeen,
  markTourSeen,
  markTourStep,
  recordEvent,
  resetTips as resetTipsStore,
  setChecklistHidden,
  type StoredOnboarding,
} from "@/lib/onboardingStore";
import { supabase } from "@/lib/supabase";
import { AnchorRegistryContext, type AnchorRect, type AnchorRegistry, type ViewRef } from "./context";
import { Spotlight } from "./Spotlight";
import { TipCard } from "./TipCard";
import { RouteTips } from "./Tips";

type TourKind = "full" | "whats_new" | "manual";
type ActiveTour = { steps: TourStep[]; index: number; kind: TourKind };

export type TourController = {
  /** Called by the Recordings tab when it mounts: starts the welcome tour for
   * a new user (never while a recording runs or over a recovery notice).
   * Returns a cleanup the screen can call on unmount. */
  requestAutoTour(hasRecordings: boolean): () => void;
  /** Settings: run the whole tour again. */
  retakeTour(): void;
  /** Settings: bring the getting-started checklist back. */
  showChecklist(): void;
  /** Settings: hide the getting-started checklist card. */
  hideChecklist(): void;
  /** Settings: all one-time tips can show again. */
  resetTips(): void;
  /** Screens with a conditional tip (tasks review, settings, team admin). */
  showTip(tip: Tip): void;
  /** Marks a one-time tip as seen for the current user. */
  dismissTip(tip: Tip): void;
  state: StoredOnboarding;
  userId: string | null;
  ready: boolean;
};

const ControllerContext = createContext<TourController>({
  requestAutoTour: () => () => undefined,
  retakeTour: () => undefined,
  showChecklist: () => undefined,
  hideChecklist: () => undefined,
  resetTips: () => undefined,
  showTip: () => undefined,
  dismissTip: () => undefined,
  state: EMPTY_STORED,
  userId: null,
  ready: false,
});

export function useTourController(): TourController {
  return useContext(ControllerContext);
}

const AUTO_START_DELAY_MS = 2500;
const MEASURE_INTERVAL_MS = 600;

export function TourProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<StoredOnboarding>(EMPTY_STORED);
  const [ready, setReady] = useState(false);
  const [tour, setTour] = useState<ActiveTour | null>(null);
  const [activeTip, setActiveTip] = useState<Tip | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [large, setLarge] = useState(false);
  const anchors = useRef(new Map<string, RefObject<ViewRef | null>>());
  const pathname = usePathname();
  const router = useRouter();

  // Session: tours and tips work only for signed-in users.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) {
        clearMemory();
        setTour(null);
        setActiveTip(null);
      }
      setUserId(s?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) {
      const t = setTimeout(() => {
        setState(EMPTY_STORED);
        setReady(false);
      }, 0);
      return () => clearTimeout(t);
    }
    let live = true;
    loadState(userId).then((s) => {
      if (live) {
        setState(s);
        setReady(true);
      }
    });
    return () => {
      live = false;
    };
  }, [userId]);

  // Reduce Motion: fades only, no movement.
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
  }, []);

  // Field mode users get larger text and buttons in the tour.
  useEffect(() => {
    AsyncStorage.getItem("settings.v1")
      .then((raw) => {
        if (!raw) return;
        const s = JSON.parse(raw) as { fieldMode?: boolean };
        setLarge(Boolean(s.fieldMode));
      })
      .catch(() => undefined);
  }, []);

  // An active recording stands down the tour and tips. The record screen keeps
  // the same session marker the crash-recovery path uses.
  useEffect(() => {
    let busy = false;
    const check = () => {
      AsyncStorage.getItem("recorder.active.v1")
        .then((v) => {
          busy = Boolean(v);
          if (busy) {
            setTour(null);
            setActiveTip(null);
          }
        })
        .catch(() => undefined);
    };
    check();
    const iv = setInterval(check, 4000);
    return () => clearInterval(iv);
  }, []);

  // A stopped tour records where it ended, so analytics can see abandonment.
  const startTour = useCallback(
    (kind: TourKind, steps: TourStep[]) => {
      AsyncStorage.getItem("recorder.active.v1")
        .then((v) => {
          if (v) return; // never while a recording runs
          setTour({ steps, index: 0, kind });
          if (userId) recordEvent(userId, "tour_started", null);
        })
        .catch(() => undefined);
    },
    [userId],
  );

  const requestAutoTour = useCallback(
    (hasRecordings: boolean) => {
      if (!userId || !ready || tour || activeTip) return () => undefined;
      const t = setTimeout(() => {
        AsyncStorage.getItem("recorder.active.v1")
          .then((marker) => {
            if (marker) return;
            // A recovered recording shows its notice right about now; the tour
            // stands down for this launch rather than covering the message.
            AsyncStorage.getItem("onboarding.recovered")
              .then((recovered) => {
                if (recovered) {
                  AsyncStorage.removeItem("onboarding.recovered").catch(() => undefined);
                  return;
                }
                const decision = autoTour(state, { hasRecordings });
                if (decision.kind === "none") return;
                const steps = stepsForUser(tourSteps({ bot: false }), { bot: false });
                if (!steps.length) return;
                startTour(decision.kind, steps);
              })
              .catch(() => undefined);
          })
          .catch(() => undefined);
      }, AUTO_START_DELAY_MS);
      return () => clearTimeout(t);
    },
    [userId, ready, tour, activeTip, state, startTour],
  );

  const retakeTour = useCallback(() => {
    startTour("manual", stepsForUser(tourSteps({ bot: false }), { bot: false }));
  }, [startTour]);

  const showChecklist = useCallback(() => {
    if (!userId) return;
    setChecklistHidden(userId, false).then((s) => setState(s));
  }, [userId]);

  const hideChecklist = useCallback(() => {
    if (!userId) return;
    setChecklistHidden(userId, true).then((s) => setState(s));
  }, [userId]);

  const resetTips = useCallback(() => {
    if (!userId) return;
    resetTipsStore(userId).then((s) => setState(s));
  }, [userId]);

  const showTip = useCallback((tip: Tip) => setActiveTip(tip), []);

  const dismissTip = useCallback(
    (tip: Tip) => {
      if (!userId) {
        setActiveTip(null);
        return;
      }
      markTipSeen(userId, tip.id).then((s) => setState(s));
      recordEvent(userId, "tip_dismissed", null);
      setActiveTip(null);
    },
    [userId],
  );

  // A stable handle to finish(), so callbacks defined before it can call it.
  const finishRef = useRef<(viaSkip: boolean) => void>(() => undefined);

  // Persist step progress and announce the step for screen readers.
  useEffect(() => {
    if (!tour || !userId) return;
    void markTourStep(userId, tour.index + 1).then((s) => setState(s));
    recordEvent(userId, "step_viewed", tour.index + 1);
    const step = tour.steps[tour.index];
    if (step) {
      AccessibilityInfo.announceForAccessibility(
        `Step ${tour.index + 1} of ${tour.steps.length}. ${step.title}.`,
      );
    }
  }, [tour, userId]);

  // Last stop: mark the tour done, then take the user straight to Record.
  const finishAndRecord = useCallback(() => {
    finishRef.current(false);
    void router.push("/record");
  }, [router]);

  const finish = useCallback(
    (viaSkip: boolean) => {
      if (!tour || !userId) return;
      const last = viaSkip ? tour.index + 1 : tour.steps.length;
      void markTourSeen(userId, viaSkip ? "skipped" : "completed", last, TOUR_VERSION).then((s) =>
        setState(s),
      );
      recordEvent(userId, viaSkip ? "tour_skipped" : "tour_completed", last);
      setTour(null);
    },
    [tour, userId],
  );
  // Keep the stable handle current without touching refs during render.
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  // Advance, skipping steps whose anchor isn't on screen; finish at the end.
  const goTo = useCallback(
    (index: number) => {
      if (!tour) return;
      const advance = (i: number, hops: number): void => {
        if (i >= tour.steps.length || hops > tour.steps.length) {
          finish(false);
          return;
        }
        const step = tour.steps[i];
        if (step.anchor == null || anchors.current.has(step.anchor)) {
          setTour({ ...tour, index: i });
          return;
        }
        advance(i + 1, hops + 1);
      };
      if (index < 0) {
        setTour({ ...tour, index: 0 });
        return;
      }
      advance(index, 0);
    },
    [tour, finish],
  );

  const measure = useCallback((id: string): Promise<AnchorRect | null> => {
    const ref = anchors.current.get(id);
    const view = ref?.current;
    if (!view) return Promise.resolve(null);
    return new Promise((resolve) => {
      view.measureInWindow((x, y, width, height) => {
        if (!width || !height) return resolve(null);
        resolve({ x, y, width, height });
      });
    });
  }, []);

  const registry: AnchorRegistry = useMemo(
    () => ({
      register: (id, ref) => anchors.current.set(id, ref),
      unregister: (id) => anchors.current.delete(id),
      measure,
      has: (id) => anchors.current.has(id),
    }),
    [measure],
  );

  const controller: TourController = useMemo(
    () => ({
      requestAutoTour,
      retakeTour,
      showChecklist,
      hideChecklist,
      resetTips,
      showTip,
      dismissTip,
      state,
      userId,
      ready,
    }),
    [
      requestAutoTour,
      retakeTour,
      showChecklist,
      hideChecklist,
      resetTips,
      showTip,
      dismissTip,
      state,
      userId,
      ready,
    ],
  );

  const tourStep = tour?.steps[tour.index] ?? null;
  const [rect, setRect] = useState<AnchorRect | null>(null);

  // Measure the active step's anchor on entry and while the step is up (the
  // interval covers layout shifts: rotation, resize, keyboard, list changes).
  useEffect(() => {
    if (!tour || !tourStep || tourStep.anchor == null) {
      const t = setTimeout(() => setRect(null), 0);
      return () => clearTimeout(t);
    }
    let live = true;
    const run = () => {
      measure(tourStep.anchor!).then((r) => {
        if (live) setRect(r);
      });
    };
    run();
    const iv = setInterval(run, MEASURE_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, [tour, tourStep, measure]);

  const isLast = tour ? tour.index === tour.steps.length - 1 : false;

  return (
    <AnchorRegistryContext.Provider value={registry}>
      <ControllerContext.Provider value={controller}>
        {children}
        {tour && tourStep && (
          <>
            <Spotlight rect={tourStep.anchor ? rect : null} reduceMotion={reduceMotion} />
            <TipCard
              mode={tourStep.anchor ? "spotlight" : "centered"}
              targetRect={tourStep.anchor ? rect : null}
              title={tourStep.title}
              text={tourStep.text}
              stepLabel={`${tour.index + 1} of ${tour.steps.length}`}
              onBack={tour.index > 0 ? () => setTour({ ...tour, index: tour.index - 1 }) : undefined}
              onNext={() => goTo(tour.index + 1)}
              onSkip={() => finish(true)}
              nextLabel={isLast ? "Done" : "Next"}
              cta={
                tourStep.cta
                  ? { label: tourStep.cta.label, onPress: () => finishAndRecord() }
                  : undefined
              }
              large={large}
            />
          </>
        )}
        {!tour && (
          <RouteTips
            pathname={pathname}
            state={state}
            userId={userId}
            showTip={showTip}
            has={registry.has}
          />
        )}
      </ControllerContext.Provider>
    </AnchorRegistryContext.Provider>
  );
}
