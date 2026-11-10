# Dictation and shortcuts (Desktop V2, Phase 6)

Status as of 2026-10-29. Dictation shipped in the baseline and was verified there; this
document records its behavior and the Phase 6 additions around it.

## What exists (baseline, preserved)

| Feature | Status | Where |
|---|---|---|
| Push-to-talk and toggle dictation via global shortcuts | IMPLEMENTED AND VERIFIED (92 baseline tests cover shortcut parsing/behavior; live use needs hardware) | `src/main/dictation.ts`, `src/shared/shortcuts.ts` |
| Floating dictation indicator | IMPLEMENTED — frameless overlay window with state/level/cancel, pointer-pass-through except on the cancel button | `overlay.html`, `dictation.ts` |
| Local transcription for dictation | IMPLEMENTED — same Parakeet engine as recordings; cloud option exists and is explicit | `renderer/dictation.ts` |
| Punctuation/formatting | IMPLEMENTED — `shared/formatting.ts` post-processing, tested | `formatting.ts` |
| Custom vocabulary | IMPLEMENTED — dictionary replacements, tested | `shared/dictionary.ts` |
| History (local-only) | IMPLEMENTED — searchable, copyable, clearable; never uploaded | `dictation.ts` |
| Text insertion | IMPLEMENTED — three methods (clipboard, paste simulation, typing) selectable; clipboard method preserves/restores the prior clipboard; honest about apps it cannot reach | `dictation.ts`, `shared/insert.ts` |

## Safety properties (from code)

- Shortcuts are unregistered on quit and report any that the OS would not grant, so a
  conflict is visible instead of silent (`main.ts` warns by name).
- The overlay cannot intercept clicks anywhere except its own cancel button
  (`overlay:hover` rect protocol).
- Dictation history stays on this computer; nothing in the dictation path uploads audio
  or text unless the user explicitly picked the cloud provider for that dictation.

## Phase 6 additions

- The main process now records `uncaughtException`/`unhandledRejection` to a bounded
  local log (`logs/app.log`, 3 × 512 KB, JSONL, no recording content). A dictation
  failure now leaves a trace the user can share, without a telemetry service.

## Honest limits

- Whether dictation inserts into *your* specific target application (some games,
  elevated windows, remote desktops) cannot be claimed universally; the app offers the
  three methods and the docs say to try them. No accessibility-permission-bypassing
  insertion is used on any platform.
- Live verification on real hardware (mic + a target app) remains NOT TESTED here.
