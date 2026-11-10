// Onboarding logic: the welcome tour's steps, the getting-started checklist and
// the one-time tips. Pure and free of React Native imports so it runs under
// `node --test` and can be checked against every user situation without a device.
// I/O (server row + AsyncStorage cache) lives in `onboardingStore.ts`.

import { APP_NAME } from "./config.ts";

/** Bump when the tour changes. Steps marked `newIn` only show to users whose
 * seen version is lower — as a short "What's new" tour, never the full tour. */
export const TOUR_VERSION = 1;

/** The screen routes tips belong to. Used by the provider to only offer a tip
 * on the screen it makes sense on. */
export type TipId =
  | "record_consent"
  | "record_type"
  | "first_processing"
  | "detail_transcript"
  | "detail_tasks"
  | "detail_ask"
  | "detail_export"
  | "detail_more"
  | "tasks_review"
  | "share_links"
  | "settings_first"
  | "field_mode_on"
  | "team_admin";

export type TourStep = {
  /** Anchor id registered by a TourAnchor. null = centred card, no spotlight. */
  anchor: string | null;
  title: string;
  text: string;
  /** Last stop's call to action. */
  cta?: { label: string; route: string };
  /** Only include when this feature is available (checked with the same calls
   * the screens use). Missing anchors are skipped later, at render time. */
  require?: "bot";
  /** First tour version this step appears in. */
  newIn?: number;
};

/** Copy is plain and short, per the product voice. No exclamation marks. */
export function tourSteps(features: { bot: boolean }): TourStep[] {
  const steps: TourStep[] = [
    {
      anchor: null,
      title: `Welcome to ${APP_NAME}`,
      text: "Record a meeting, call, lecture or site walk. You get a transcript, notes and a task list, and every task shows the words it came from so you can check it.",
    },
    {
      anchor: "record-button",
      title: "Start here",
      text: "Tap Record and put your phone down. It keeps saving as you go, so nothing is lost if the app closes or you lose signal.",
    },
    {
      anchor: "add-button",
      title: "Already have audio?",
      text: features.bot
        ? "Import a file or a link and get the same notes. Or send a notetaker to an online meeting you can't join."
        : "Import a file or a link and get the same notes.",
    },
    {
      anchor: "tab-projects",
      title: "Keep things together",
      text: "Make a project for each client, job site or team. Before each new meeting you'll see what's still open from the last one.",
    },
    {
      anchor: "tab-search",
      title: "Find anything that was said",
      text: 'Search every transcript, or ask a question like "What did we decide about the budget?" and get an answer with links to the recordings.',
    },
    {
      anchor: "tab-tasks",
      title: "Your action items",
      text: "Tasks from every recording land here. Ones the AI wasn't sure about wait in To review until you keep or dismiss them.",
    },
    {
      anchor: null,
      title: "You're set",
      text: `Try a 30-second test now: tap Record, say a sentence or two with something like "I'll send the report on Friday", then tap Stop.`,
      cta: { label: "Record a test", route: "/record" },
    },
  ];
  return steps;
}

/** Steps for a "What's new" mini-tour after a version bump: only what's new. */
export function whatsNewSteps(
  seenVersion: number,
  features: { bot: boolean },
): TourStep[] {
  return tourSteps(features).filter(
    (s) => s.newIn != null && s.newIn > seenVersion,
  );
}

/** The full tour applies when the step has no unmet feature requirement.
 * Missing anchors are filtered at render time (TourProvider), not here. */
export function stepsForUser(
  steps: TourStep[],
  features: { bot: boolean },
): TourStep[] {
  return steps.filter((s) => !s.require || features[s.require]);
}

export type OnboardingState = {
  tourVersionSeen: number;
  tourCompletedAt: string | null;
  tourSkippedAt: string | null;
  checklistHidden: boolean;
  tipsSeen: string[];
};

export const EMPTY_STATE: OnboardingState = {
  tourVersionSeen: 0,
  tourCompletedAt: null,
  tourSkippedAt: null,
  checklistHidden: false,
  tipsSeen: [],
};

/** Which tour (if any) should start by itself. Manual restarts are handled
 * separately and always run the full tour.
 * - A brand-new user (no recordings yet) gets the full welcome tour once.
 * - A user who already had recordings when the tour shipped doesn't get it
 *   automatically; they see the checklist instead.
 * - After a version bump, users who finished or skipped the old tour get only
 *   the "What's new" steps. */
export function autoTour(
  state: OnboardingState,
  data: { hasRecordings: boolean },
): { kind: "full" | "whats_new" | "none" } {
  if (state.tourVersionSeen >= TOUR_VERSION) return { kind: "none" };
  if (state.tourCompletedAt || state.tourSkippedAt) {
    return whatsNewSteps(state.tourVersionSeen, { bot: false }).length
      ? { kind: "whats_new" }
      : { kind: "none" };
  }
  return data.hasRecordings ? { kind: "none" } : { kind: "full" };
}

// ---------------------------------------------------------------------------
// Getting-started checklist
// ---------------------------------------------------------------------------

export type ChecklistKey =
  | "make_recording"
  | "open_notes"
  | "check_task"
  | "make_project"
  | "search_or_ask";

export type ChecklistData = {
  hasRecordings: boolean;
  hasReadyOpened: boolean;
  hasTaskAction: boolean;
  hasProject: boolean;
  hasSearch: boolean;
};

export type ChecklistItem = {
  key: ChecklistKey;
  title: string;
  done: boolean;
  /** Where the item takes the user when it isn't done yet. */
  route: string;
};

export const CHECKLIST_TOTAL = 5;

export function checklist(data: ChecklistData): ChecklistItem[] {
  return [
    {
      key: "make_recording",
      title: "Make your first recording",
      done: data.hasRecordings,
      route: "/record",
    },
    {
      key: "open_notes",
      title: "Open your notes",
      done: data.hasReadyOpened,
      // The screen picks the newest ready recording.
      route: "/recordings/newest-ready",
    },
    {
      key: "check_task",
      title: "Check a task",
      done: data.hasTaskAction,
      route: "/tasks",
    },
    {
      key: "make_project",
      title: "Make a project",
      done: data.hasProject,
      route: "/projects",
    },
    {
      key: "search_or_ask",
      title: "Search or ask",
      done: data.hasSearch,
      route: "/search",
    },
  ];
}

export function checklistProgress(items: ChecklistItem[]): {
  done: number;
  total: number;
  allDone: boolean;
} {
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, allDone: done === items.length };
}

// ---------------------------------------------------------------------------
// One-time tips
// ---------------------------------------------------------------------------

export type Tip = {
  id: TipId;
  /** Route the tip belongs to. The provider only shows a tip on its screen. */
  screen: string;
  /** Anchor the tip card sits next to. */
  anchor: string | null;
  title: string;
  text: string;
  /** Tips in the same group show one after another, in order. */
  group?: string;
  /** Only offer when this is true. */
  require?: "fieldMode" | "reviewItems" | "isAdmin";
};

export const TIPS: Tip[] = [
  {
    id: "record_consent",
    screen: "/record",
    anchor: "consent-section",
    title: "Let people know",
    text: "Many places require everyone's OK before you record. Say the sentence below, or send the consent link.",
    group: "record",
  },
  {
    id: "record_type",
    screen: "/record",
    anchor: "type-picker",
    title: "What is it?",
    text: "Pick the type so the notes fit, e.g. Site walk gives you a daily log.",
    group: "record",
  },
  {
    id: "first_processing",
    screen: "/recording",
    anchor: "status-pill",
    title: "Writing your notes",
    text: "Writing your notes. This usually takes a minute or two. You can leave this screen.",
  },
  {
    id: "detail_transcript",
    screen: "/recording",
    anchor: "detail-tabs",
    title: "Transcript",
    text: "Tap a line to play it. Press and hold for bookmarks, clips and fixes.",
    group: "detail",
  },
  {
    id: "detail_tasks",
    screen: "/recording",
    anchor: "detail-tabs",
    title: "Tasks",
    text: "Each task shows the quote it came from. Tap the quote to hear it.",
    group: "detail",
  },
  {
    id: "detail_ask",
    screen: "/recording",
    anchor: "detail-tabs",
    title: "Ask",
    text: "Ask anything about this conversation.",
    group: "detail",
  },
  {
    id: "detail_export",
    screen: "/recording",
    anchor: null,
    title: "Export or share",
    text: "The Export button at the top saves or sends the notes, transcript and audio.",
    group: "detail",
  },
  {
    id: "detail_more",
    screen: "/recording",
    anchor: null,
    title: "More actions",
    text: "More opens the rest: make a deck, draft a follow-up email, translate, add photos, and delete.",
    group: "detail",
  },
  {
    id: "tasks_review",
    screen: "/tasks",
    anchor: "segment-review",
    title: "To review",
    text: "These were only suggestions, or the owner wasn't clear. Keep the real ones, dismiss the rest.",
    require: "reviewItems",
  },
  {
    id: "share_links",
    screen: "/share",
    anchor: "share-link-card",
    title: "Sharing",
    text: "Links show only confirmed tasks and decisions. You can turn a link off any time.",
  },
  {
    id: "settings_first",
    screen: "/settings",
    anchor: "settings-first-card",
    title: "Settings",
    text: "Turn on Field mode for big buttons on site, connect a calendar for meeting briefs, or create a team to share projects.",
  },
  {
    id: "field_mode_on",
    screen: "/settings",
    anchor: "field-mode-toggle",
    title: "Field mode",
    text: "Photo button is bigger now, and new recordings default to Site walk.",
    require: "fieldMode",
  },
  {
    id: "team_admin",
    screen: "/team",
    anchor: "admin-console",
    title: "Admin console",
    text: "Policies, audit log and usage for your whole team live here.",
    require: "isAdmin",
  },
];

/** The tips that could show now, in group order, for the given path.
 * Exact path matches and prefix matches (a detail screen like
 * /recording/<id> carries its screen's tips) both count. Already-seen tips and
 * unmet requirements are excluded. The provider then drops any whose anchor is
 * missing and shows at most one. */
export function tipsForScreen(
  path: string,
  state: OnboardingState,
  features: { reviewItems: boolean; fieldMode: boolean; isAdmin: boolean },
): Tip[] {
  return TIPS.filter(
    (t) =>
      (path === t.screen || path.startsWith(t.screen + "/")) &&
      !state.tipsSeen.includes(t.id) &&
      (!t.require || features[t.require]),
  );
}

/** True when a new user should be shown the getting-started checklist card:
 * not hidden, and something is still unticked. */
export function shouldShowChecklist(
  state: OnboardingState,
  data: ChecklistData,
): boolean {
  if (state.checklistHidden) return false;
  const { allDone } = checklistProgress(checklist(data));
  return !allDone;
}
