// Onboarding state I/O: an AsyncStorage cache (fast, works offline) backed by
// a server row in `user_onboarding` (so web and phone agree). Writes go to the
// cache immediately and to the server in the background — a failed save never
// blocks the UI or loses state; the next successful save carries everything.
//
// Loading merges rather than picks a winner: each field takes the "furthest
// along" value, so an offline phone and the server converge.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { EMPTY_STATE, type OnboardingState } from "./onboarding";

const CACHE_KEY = "onboarding.state.v1";

/** Everything the server row stores, in the shape the app uses. */
export type StoredOnboarding = OnboardingState & {
  tourLastStep: number | null;
  firstSearchAt: string | null;
  firstReadyOpenedAt: string | null;
  firstTaskActionAt: string | null;
};

export const EMPTY_STORED: StoredOnboarding = {
  ...EMPTY_STATE,
  tourLastStep: null,
  firstSearchAt: null,
  firstReadyOpenedAt: null,
  firstTaskActionAt: null,
};

type Row = {
  tour_version_seen: number;
  tour_completed_at: string | null;
  tour_skipped_at: string | null;
  tour_last_step: number | null;
  checklist_hidden: boolean;
  tips_seen: string[];
  first_search_at: string | null;
  first_ready_opened_at: string | null;
  first_task_action_at: string | null;
};

function fromRow(row: Row): StoredOnboarding {
  return {
    tourVersionSeen: row.tour_version_seen ?? 0,
    tourCompletedAt: row.tour_completed_at ?? null,
    tourSkippedAt: row.tour_skipped_at ?? null,
    tourLastStep: row.tour_last_step ?? null,
    checklistHidden: row.checklist_hidden ?? false,
    tipsSeen: row.tips_seen ?? [],
    firstSearchAt: row.first_search_at ?? null,
    firstReadyOpenedAt: row.first_ready_opened_at ?? null,
    firstTaskActionAt: row.first_task_action_at ?? null,
  };
}

function toRow(s: StoredOnboarding): Row {
  return {
    tour_version_seen: s.tourVersionSeen,
    tour_completed_at: s.tourCompletedAt,
    tour_skipped_at: s.tourSkippedAt,
    tour_last_step: s.tourLastStep,
    checklist_hidden: s.checklistHidden,
    tips_seen: s.tipsSeen,
    first_search_at: s.firstSearchAt,
    first_ready_opened_at: s.firstReadyOpenedAt,
    first_task_action_at: s.firstTaskActionAt,
  };
}

/** Merge two states: whichever value is "further along" wins. */
export function mergeStates(a: StoredOnboarding, b: StoredOnboarding): StoredOnboarding {
  const first = (x: string | null, y: string | null) => x ?? y;
  return {
    tourVersionSeen: Math.max(a.tourVersionSeen, b.tourVersionSeen),
    tourCompletedAt: first(a.tourCompletedAt, b.tourCompletedAt),
    tourSkippedAt: first(a.tourSkippedAt, b.tourSkippedAt),
    tourLastStep: a.tourLastStep ?? b.tourLastStep,
    checklistHidden: a.checklistHidden || b.checklistHidden,
    tipsSeen: Array.from(new Set([...a.tipsSeen, ...b.tipsSeen])),
    firstSearchAt: first(a.firstSearchAt, b.firstSearchAt),
    firstReadyOpenedAt: first(a.firstReadyOpenedAt, b.firstReadyOpenedAt),
    firstTaskActionAt: first(a.firstTaskActionAt, b.firstTaskActionAt),
  };
}

async function readCache(): Promise<StoredOnboarding> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? { ...EMPTY_STORED, ...(JSON.parse(raw) as StoredOnboarding) } : EMPTY_STORED;
  } catch {
    return EMPTY_STORED;
  }
}

async function writeCache(state: StoredOnboarding): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable: the in-memory copy still works this session.
  }
}

let memory: StoredOnboarding | null = null;
let memoryOwner: string | null = null;

/** Load the user's onboarding state: cache first (instant), then the server
 * row merged over it. Never throws. */
export async function loadState(userId: string): Promise<StoredOnboarding> {
  if (memory && memoryOwner === userId) return memory;
  let state = await readCache();
  try {
    const { data, error } = await supabase
      .from("user_onboarding")
      .select(
        "tour_version_seen, tour_completed_at, tour_skipped_at, tour_last_step, checklist_hidden, tips_seen, first_search_at, first_ready_opened_at, first_task_action_at",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (!error && data) state = mergeStates(state, fromRow(data as Row));
  } catch {
    // Offline: the cache (or the empty state) is used and the server is
    // reconciled on the next save.
  }
  memory = state;
  memoryOwner = userId;
  await writeCache(state);
  return state;
}

/** Apply a change and persist it. Server writes are fire-and-forget. */
async function apply(
  userId: string,
  change: (s: StoredOnboarding) => StoredOnboarding,
): Promise<StoredOnboarding> {
  const current = memory && memoryOwner === userId ? memory : await loadState(userId);
  const next = change(current);
  memory = next;
  memoryOwner = userId;
  void writeCache(next);
  void supabase
    .from("user_onboarding")
    .upsert({ user_id: userId, ...toRow(next) }, { onConflict: "user_id" })
    .then(undefined, () => undefined);
  return next;
}

/** Record that the user saw (finished or skipped) the tour at a version. */
export function markTourSeen(
  userId: string,
  kind: "completed" | "skipped",
  lastStep: number | null,
  version: number,
): Promise<StoredOnboarding> {
  return apply(userId, (s) => ({
    ...s,
    tourVersionSeen: Math.max(s.tourVersionSeen, version),
    tourCompletedAt: kind === "completed" ? new Date().toISOString() : s.tourCompletedAt,
    tourSkippedAt: kind === "skipped" ? new Date().toISOString() : s.tourSkippedAt,
    tourLastStep: lastStep,
  }));
}

/** Track progress so a half-finished tour can be analysed (where people stop). */
export function markTourStep(userId: string, step: number): Promise<StoredOnboarding> {
  return apply(userId, (s) => ({ ...s, tourLastStep: step }));
}

export function setChecklistHidden(
  userId: string,
  hidden: boolean,
): Promise<StoredOnboarding> {
  return apply(userId, (s) => ({ ...s, checklistHidden: hidden }));
}

export function markTipSeen(userId: string, id: string): Promise<StoredOnboarding> {
  return apply(userId, (s) =>
    s.tipsSeen.includes(id) ? s : { ...s, tipsSeen: [...s.tipsSeen, id] },
  );
}

/** "Reset tips" in Settings: every one-time tip can show again. */
export function resetTips(userId: string): Promise<StoredOnboarding> {
  return apply(userId, (s) => ({ ...s, tipsSeen: [] }));
}

/** First-time activity for the checklist: only the first occurrence is kept. */
function markFirst(
  userId: string,
  which: "firstSearchAt" | "firstReadyOpenedAt" | "firstTaskActionAt",
): Promise<StoredOnboarding> {
  return apply(userId, (s) => (s[which] ? s : { ...s, [which]: new Date().toISOString() }));
}

export const markFirstSearch = (userId: string) => markFirst(userId, "firstSearchAt");
export const markFirstReadyOpened = (userId: string) => markFirst(userId, "firstReadyOpenedAt");
export const markFirstTaskAction = (userId: string) => markFirst(userId, "firstTaskActionAt");

/** Fire-and-forget analytics: never blocks, never throws, stores no content. */
export function recordEvent(userId: string, event: string, step: number | null): void {
  void supabase
    .from("onboarding_events")
    .insert({ user_id: userId, event, step })
    .then(undefined, () => undefined);
}

/** Forget the cached copy (used on sign-out so the next user starts clean). */
export function clearMemory(): void {
  memory = null;
  memoryOwner = null;
}
