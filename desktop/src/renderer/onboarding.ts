// The desktop's getting-started checklist, built on the same shared onboarding
// logic the phone and web use (src/lib/onboarding.ts). The steps are derived from
// real data - a step is done when the thing actually exists - and progress events
// go to the same onboarding_events table, so an admin sees one picture of
// onboarding across all three apps.
import {
  CHECKLIST_TOTAL,
  checklist,
  checklistProgress,
  type ChecklistData,
  type ChecklistItem,
} from "../../../src/lib/onboarding.ts";

export type DesktopChecklistData = {
  hasRecordings: boolean;
  hasReadyOpened: boolean;
  hasTaskAction: boolean;
  hasProject: boolean;
  hasSearch: boolean;
};

/** Desktop actions map onto the shared checklist; tasks/search have no desktop
 * screen yet, so those two stay open until the user does them in the web app
 * (their timestamps are shared through user_onboarding). */
export function desktopChecklist(data: DesktopChecklistData): ChecklistItem[] {
  return checklist({
    hasRecordings: data.hasRecordings,
    hasReadyOpened: data.hasReadyOpened,
    hasTaskAction: data.hasTaskAction,
    hasProject: data.hasProject,
    hasSearch: data.hasSearch,
  });
}

export { checklistProgress, CHECKLIST_TOTAL };
export type { ChecklistData, ChecklistItem };

/** The user_onboarding row the desktop needs, when it exists. */
export type OnboardingRow = {
  checklist_hidden: boolean | null;
  first_ready_opened_at: string | null;
  first_task_action_at: string | null;
  first_search_at: string | null;
  tour_version_seen: number | null;
} | null;

export function rowToChecklistData(
  row: OnboardingRow,
  counts: { recordings: number; projects: number },
): DesktopChecklistData {
  return {
    hasRecordings: counts.recordings > 0,
    hasReadyOpened: Boolean(row?.first_ready_opened_at),
    hasTaskAction: Boolean(row?.first_task_action_at),
    hasProject: counts.projects > 0,
    hasSearch: Boolean(row?.first_search_at),
  };
}

/** The user_onboarding row values a desktop action should stamp. */
export function stampFor(action: "open_notes"): {
  first_ready_opened_at: string;
} | null {
  if (action === "open_notes") return { first_ready_opened_at: new Date().toISOString() };
  return null;
}
