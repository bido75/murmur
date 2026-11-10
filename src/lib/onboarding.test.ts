import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoTour,
  checklist,
  checklistProgress,
  EMPTY_STATE,
  shouldShowChecklist,
  stepsForUser,
  tipsForScreen,
  TOUR_VERSION,
  tourSteps,
  whatsNewSteps,
  type OnboardingState,
} from "./onboarding.ts";
import { APP_NAME } from "./config.ts";

const bot = { bot: true };
const noBot = { bot: false };

test("the tour has seven stops and uses the app name, never a literal", () => {
  const steps = tourSteps(bot);
  assert.equal(steps.length, 7);
  assert.equal(steps[0].anchor, null, "first stop is a centred card");
  assert.equal(steps[0].title, `Welcome to ${APP_NAME}`);
  assert.ok(!steps[0].title.includes("Murmur") || APP_NAME === "Murmur");
  assert.equal(steps[1].anchor, "record-button");
  assert.equal(steps[2].anchor, "add-button");
  assert.equal(steps[3].anchor, "tab-projects");
  assert.equal(steps[4].anchor, "tab-search");
  assert.equal(steps[5].anchor, "tab-tasks");
  assert.equal(steps[6].anchor, null, "last stop is a centred card");
  assert.deepEqual(steps[6].cta, { label: "Record a test", route: "/record" });
});

test("the Add stop mentions the notetaker only when the bot is available", () => {
  const withBot = tourSteps(bot)[2].text;
  const withoutBot = tourSteps(noBot)[2].text;
  assert.match(withBot, /notetaker/);
  assert.doesNotMatch(withoutBot, /notetaker/);
});

test("steps with unmet feature requirements are filtered", () => {
  // No step in tour v1 requires the bot at the step level; this guards the
  // mechanism for future versions.
  const steps = [
    { anchor: "a", title: "A", text: "", require: "bot" as const },
    { anchor: "b", title: "B", text: "" },
  ];
  assert.equal(stepsForUser(steps, bot).length, 2);
  assert.equal(stepsForUser(steps, noBot).length, 1);
});

test("auto tour: a brand-new user gets the full tour", () => {
  assert.deepEqual(
    autoTour(EMPTY_STATE, { hasRecordings: false }),
    { kind: "full" },
  );
});

test("auto tour: a user who already had recordings doesn't get it", () => {
  assert.deepEqual(
    autoTour(EMPTY_STATE, { hasRecordings: true }),
    { kind: "none" },
  );
});

test("auto tour: completed and skipped users don't see it again at the same version", () => {
  const done: OnboardingState = {
    ...EMPTY_STATE,
    tourVersionSeen: TOUR_VERSION,
    tourCompletedAt: new Date().toISOString(),
  };
  const skipped: OnboardingState = {
    ...EMPTY_STATE,
    tourVersionSeen: TOUR_VERSION,
    tourSkippedAt: new Date().toISOString(),
  };
  assert.deepEqual(autoTour(done, { hasRecordings: false }), { kind: "none" });
  assert.deepEqual(autoTour(skipped, { hasRecordings: false }), { kind: "none" });
});

test("auto tour: a version bump with new steps shows only what's new", () => {
  // No step in v1 is marked newIn yet, so a bump to the current version from an
  // older seen version yields no steps — this exercises the mechanism.
  const older: OnboardingState = {
    ...EMPTY_STATE,
    tourVersionSeen: Math.max(0, TOUR_VERSION - 1),
    tourCompletedAt: new Date().toISOString(),
  };
  const result = autoTour(older, { hasRecordings: true });
  if (whatsNewSteps(older.tourVersionSeen, bot).length > 0) {
    assert.deepEqual(result, { kind: "whats_new" });
  } else {
    assert.deepEqual(result, { kind: "none" });
  }
  assert.equal(whatsNewSteps(TOUR_VERSION, bot).length, 0);
});

test("the checklist ticks from real activity", () => {
  const nothing = checklist({
    hasRecordings: false,
    hasReadyOpened: false,
    hasTaskAction: false,
    hasProject: false,
    hasSearch: false,
  });
  assert.deepEqual(checklistProgress(nothing), { done: 0, total: 5, allDone: false });
  assert.deepEqual(
    nothing.map((i) => i.done),
    [false, false, false, false, false],
  );

  const all = checklist({
    hasRecordings: true,
    hasReadyOpened: true,
    hasTaskAction: true,
    hasProject: true,
    hasSearch: true,
  });
  assert.deepEqual(checklistProgress(all), { done: 5, total: 5, allDone: true });
});

test("checklist items tick independently and carry their route", () => {
  const partial = checklist({
    hasRecordings: true,
    hasReadyOpened: false,
    hasTaskAction: true,
    hasProject: false,
    hasSearch: false,
  });
  assert.equal(partial[0].done, true);
  assert.equal(partial[1].done, false);
  assert.equal(partial[2].done, true);
  assert.equal(partial[3].done, false);
  assert.equal(partial[1].route, "/recordings/newest-ready");
  assert.equal(partial[3].route, "/projects");
});

test("the checklist card hides when hidden by the user or when all is done", () => {
  const nothing = {
    hasRecordings: false,
    hasReadyOpened: false,
    hasTaskAction: false,
    hasProject: false,
    hasSearch: false,
  };
  assert.equal(shouldShowChecklist(EMPTY_STATE, nothing), true);
  assert.equal(
    shouldShowChecklist({ ...EMPTY_STATE, checklistHidden: true }, nothing),
    false,
  );
  const all = {
    hasRecordings: true,
    hasReadyOpened: true,
    hasTaskAction: true,
    hasProject: true,
    hasSearch: true,
  };
  assert.equal(shouldShowChecklist(EMPTY_STATE, all), false);
});

test("tips are per-screen, one-time and gated by their requirement", () => {
  const seenNothing = EMPTY_STATE;
  // Record screen: two tips in one group.
  const onRecord = tipsForScreen("/record", seenNothing, {
    reviewItems: false,
    fieldMode: false,
    isAdmin: false,
  });
  assert.deepEqual(
    onRecord.map((t) => t.id),
    ["record_consent", "record_type"],
  );

  // Seen tips are excluded.
  const seenOne: OnboardingState = { ...EMPTY_STATE, tipsSeen: ["record_consent"] };
  assert.deepEqual(
    tipsForScreen("/record", seenOne, { reviewItems: false, fieldMode: false, isAdmin: false }).map((t) => t.id),
    ["record_type"],
  );

  // Other screens don't get another screen's tips.
  assert.deepEqual(
    tipsForScreen("/share", seenNothing, { reviewItems: false, fieldMode: false, isAdmin: false }).map((t) => t.id),
    ["share_links"],
  );
  assert.deepEqual(
    tipsForScreen("/recording/meeting-1", seenNothing, { reviewItems: false, fieldMode: false, isAdmin: false }).map((t) => t.id),
    ["first_processing", "detail_transcript", "detail_tasks", "detail_ask", "detail_export", "detail_more"],
  );

  // Gated tips stay hidden until their requirement is met.
  assert.deepEqual(
    tipsForScreen("/tasks", seenNothing, { reviewItems: false, fieldMode: false, isAdmin: false }),
    [],
  );
  assert.deepEqual(
    tipsForScreen("/tasks", seenNothing, { reviewItems: true, fieldMode: false, isAdmin: false }).map((t) => t.id),
    ["tasks_review"],
  );
  assert.deepEqual(
    tipsForScreen("/settings", seenNothing, { reviewItems: false, fieldMode: true, isAdmin: false }).map((t) => t.id),
    ["settings_first", "field_mode_on"],
  );
  assert.deepEqual(
    tipsForScreen("/team", seenNothing, { reviewItems: false, fieldMode: false, isAdmin: true }).map((t) => t.id),
    ["team_admin"],
  );
});
