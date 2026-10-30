# Accessibility review

Focus of the remediation branch `feature/murmur-app-remediation`. Findings are
verified against the source and the actual components; the audit tool's
accessibility-tree observations were re-checked rather than accepted at face value.

## Fixed

### Radio buttons used `selected` instead of `checked`

Every custom radio (`accessibilityRole="radio"`) in `record`, `privacy`, `deck`,
`templates`, `ProjectPicker` and `settings` used
`accessibilityState={{ selected }}`, which is the tab/segment convention. React
Native radios must expose `checked` for screen readers to announce the correct
state. All are now `checked`; the `Segmented` component in `ui.tsx` correctly keeps
`selected` because it is a tab control.

### Default type now has a meaningful, accessible group state

The "Default type" radios on Settings expose a checked state a screen reader can
read, and Field Mode no longer overwrites the user's selection (so the announced
state reflects the real, persisted value).

### Switch labels

The Recording notice and Field mode switches already carried `accessibilityLabel`;
no change was required there.

## Verified correct (no change)

- **Dialogs** return focus and close via `confirm`/`notify` in `src/lib/dialog.tsx`;
  dismissible on web with Escape/backdrop through the same shared surface.
- **Recording-detail tabs** (Notes/Transcript/Tasks/Ask) use `Segmented` with
  `accessibilityRole="tab"` and `selected`, which is the correct semantics.
- **Hidden accessibility-tree entries** on the projects/settings fields are
  legitimate conditional visibility (fields shown only in the relevant state), not
  accidental `display:none`.

## Remaining (not done on this branch)

- **Keyboard-only navigation end-to-end** has not been exercised on a physical
  device/screen reader; the semantics are correct but not yet verified with
  VoiceOver/TalkBack.
- **Touch-target sizing in Field Mode** exists; no WCAG 2.2 AA automated audit tool
  is wired into CI yet.

## Summary

Status: radios and default-type semantics fixed; tabs/dialogs/labels verified
correct. Physical screen-reader verification remains NOT TESTED and is a release
gate for a fully WCAG-conformant claim.