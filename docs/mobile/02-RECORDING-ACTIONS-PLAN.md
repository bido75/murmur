# Mobile recording-actions UX pass — audit and implementation plan

Date: 2026-10-30 · Phase 1 audit done; implementation next. Scope: `src/app/recording/[id].tsx` (1,622 lines), `src/components/ActionMenu.tsx`, the existing tour system.

## Phase 1 audit results (real code, not assumptions)

| Prompt item | Actual implementation | Status |
|---|---|---|
| Recording-details screen | `src/app/recording/[id].tsx` | exists |
| Three-dot overflow | line ~658: icon-only Pressable → `openMenu()`, `accessibilityLabel="More actions"`, `hitSlop={12}` | the discoverability problem — icon-only, no label |
| Action sheet | `ActionMenu` (`src/components/ActionMenu.tsx`) — bottom-sheet `Modal`, `MenuAction {label, onPress, destructive?}` | works; flat list, no grouping |
| Export handlers (all real) | `exportNotes` (email/export), `createShareLink` + `shareOrCopy` (clip/full share), `export-data`/`make-deck`/`followup`/`translateRecording` via functions | functional |
| Delete confirmation | `confirm()` from `lib/dialog` | exists |
| Photos / site log | `PhotoStrip`, `SendToTracker` | exist |
| Walkthrough infrastructure | **already built**: `src/components/tour/*` (TourProvider, TipCard, anchors, GettingStarted) + `user_onboarding` persistence (tips_seen, tour_version) | reuse, don't rebuild |
| Processing states | recording status machine (scheduled/recording/…) drives display | to verify per-state copy |

Mapping confirms every menu item has a real handler — the gap is **discoverability and grouping**, exactly as the operator diagnosed.

## Implementation plan (minimal-disruption slices)

**Slice 1 — Header (the acceptance criterion)**
- In the header row: replace the icon-only More with two labeled actions: `Export` (opens a new export-focused menu: Share/copy link, Download audio, Export notes, Copy text — only real handlers) and `More` (three-dot icon **with** "More" text, ≥48dp touch target, existing `openMenu()`).
- Safe-area aware; verify no overlap with the title/date block (the layout the operator flagged).
- No handler changes — actions point at existing functions.

**Slice 2 — Menu grouping**
- Extend `ActionMenu` with optional section headers (`MenuAction.section?`) and render grouped lists; keep destructive last with `confirm()`.
- Group into: Share & export / AI tools (deck, follow-up, translate, re-run notes) / Attachments & site log / Organization (move to project, trackers) / Delete (destructive, last).

**Slice 3 — First-use walkthrough (reuse the tour)**
- 5 anchored steps on this screen (Notes ready → Transcript → Tasks → Export → More), built on TourProvider/TipCard — **no `accessibilityRole="dialog"`** (the static role audit test enforces this).
- Persist via the existing `user_onboarding` tips_seen mechanism; show once; Skip/Next; re-openable from Settings.

**Slice 4 — States**
- Verify each status renders distinct copy; failed processing must not show indefinite "Writing your notes…" (server already has `fail_stale_processing()`); disable AI actions until notes ready.

**Slice 5 — Verification + build**
- Regression rows from the prompt run honestly (device rows = operator); then a fresh EAS preview APK; artifact + hash recorded in `docs/mobile/01-APK-BUILDS.md`.

## Performance verdict (delivered with this plan)

- Dev client + Metro is inherently slow (28 s first bundle in the operator's own log, ~6 MB unminified dev bundle, no optimizations). **The decisive test is the corrected preview APK (`8219652c`)** — release Hermes bundle, embedded, no Metro.
- Measured tunnel overhead: ~180–380 ms per roundtrip (local kong: 46–102 ms) + mobile-network RTT on top; OTP login = 2 roundtrips + **email delivery time** (SMTP latency, not app logic).
- If the preview APK still feels slow, next levers: SMTP relay timing, Cloudflare tuning, and reducing boot-time serial fetches — each measurable.
