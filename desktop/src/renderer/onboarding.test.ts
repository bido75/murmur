import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECKLIST_TOTAL,
  checklistProgress,
  desktopChecklist,
  rowToChecklistData,
  stampFor,
} from "./onboarding.ts";

test("a fresh user has every step open", () => {
  const items = desktopChecklist({
    hasRecordings: false,
    hasReadyOpened: false,
    hasTaskAction: false,
    hasProject: false,
    hasSearch: false,
  });
  const p = checklistProgress(items);
  assert.equal(p.done, 0);
  assert.equal(p.total, CHECKLIST_TOTAL);
  assert.equal(p.allDone, false);
});

test("steps derive from real data, not stored flags", () => {
  const items = desktopChecklist({
    hasRecordings: true,
    hasReadyOpened: false,
    hasTaskAction: true,
    hasProject: true,
    hasSearch: false,
  });
  const done = Object.fromEntries(items.map((i) => [i.key, i.done]));
  assert.equal(done.make_recording, true);
  assert.equal(done.open_notes, false);
  assert.equal(done.check_task, true);
  assert.equal(done.make_project, true);
  assert.equal(done.search_or_ask, false);
});

test("the server row fills the steps the desktop cannot see locally", () => {
  const data = rowToChecklistData(
    {
      checklist_hidden: false,
      first_ready_opened_at: "2026-01-01T00:00:00Z",
      first_task_action_at: null,
      first_search_at: "2026-01-02T00:00:00Z",
      tour_version_seen: 1,
    },
    { recordings: 3, projects: 0 },
  );
  assert.equal(data.hasReadyOpened, true);
  assert.equal(data.hasSearch, true);
  assert.equal(data.hasRecordings, true);
  assert.equal(data.hasProject, false);
  assert.equal(rowToChecklistData(null, { recordings: 0, projects: 0 }).hasRecordings, false);
});

test("opening a recording stamps the shared row timestamp", () => {
  const stamp = stampFor("open_notes");
  assert.ok(stamp?.first_ready_opened_at);
  assert.equal(Number.isNaN(Date.parse(stamp.first_ready_opened_at)), false);
});
