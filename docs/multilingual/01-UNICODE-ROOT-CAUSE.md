# 01 — Unicode Root Cause: Mojibake in the Android App

**Status:** Root cause confirmed and fixed for the confirmed corruption site; repo-wide guard added.
**Date:** 2026-10-30
**Scope:** P0 Unicode corruption fix (writing-block 19, Phase 1)

## 1. Symptom

Android screenshots showed classic double-encoded UTF-8 (mojibake):

| Displayed | Intended | U+ |
|---|---|---|
| `â€¢` | • bullet | U+2022 |
| `â€¦` | … ellipsis | U+2026 |
| `Â·` | · middle dot | U+00B7 |
| `â€”` | — em dash | U+2014 |
| `â€™` | ’ right single quote | U+2019 |
| `â€œ` / `â€` | “ / ” curly quotes | U+201C/U+201D |

This is the signature of **UTF-8 bytes re-decoded as Windows-1252 (CP1252) and re-encoded as UTF-8** — one round-trip of double encoding.

## 2. Root cause chain

1. **Generator (confirmed, primary):** The repair tooling investigation found the corruption was **baked into the committed source file** `src/app/recording/[id].tsx`. The working session that edited this file used Windows PowerShell 5.1 (`Get-Content -Raw` / `Set-Content`), which reads UTF-8 files using the system ANSI code page (CP1252) and writes back re-encoded — silently double-encoding every non-ASCII character. Commit `e652f07` repaired 22 such sequences and documents this root cause.
2. **Build pipeline (confirmed clean):** Metro/Babel read source as UTF-8; the Expo export and EAS builds preserve encoding. The bundles only carried the corruption because the source carried it.
3. **Runtime rendering (clean):** React Native Text components do not re-encode; the app has no encoding transforms in its rendering layer.
4. **Database (clean for committed content):** Supabase stores UTF-8; LLM-generated notes containing `•` arrive correctly encoded (verified — the bullet-strip regex failing to match was itself a symptom of source corruption, not DB corruption). Any user-visible DB corruption would be a separate incident; the repair tooling supports a dry-run DB repair if records are found.

## 3. Evidence

- `scripts/mojibake-scan.mjs` scans all tracked text files for CP1252-decoded signature byte sequences; before the fix it flagged `src/app/recording/[id].tsx` (22 sequences), after the fix the only flagged files are the tooling files themselves (which legitimately contain signature literals).
- `src/lib/mojibake.test.ts` asserts:
  - `repairMojibake()` repairs all 22 observed sequences;
  - a repo-wide **guard test** fails if any tracked source file (excluding the tooling) contains mojibake signatures;
  - multilingual pass-through samples (Arabic, Chinese, Japanese, Hindi, Swahili, Amharic, Twi, Yoruba, Georgian, Armenian) round-trip through repair **unchanged** — proving the repairer never corrupts correctly encoded text.
- Live verification: the rebuilt `dist-web` export (42 JS/JSON/HTML/CSS files) contains **zero** mojibake byte sequences and serves via `https://notes.giscop.com` with correct strings.

## 4. Fix applied (commit `e652f07`)

1. `src/lib/mojibake.ts` — single-pass, idempotent repair map for the exact observed double-encodings (no blind repeated replacement; `repairMojibake` detects and repairs only confident signatures, leaves clean text byte-identical).
2. `src/app/recording/[id].tsx` — 22 sequences repaired in place, including the action-menu labels (`More actions`, `Export`, etc.) and the bullet-strip regex which previously could not match LLM output.
3. `scripts/repair-mojibake.mjs` — repair tool (working-tree mode; DB dry-run mode documented below).
4. `scripts/mojibake-scan.mjs` — CI-usable scanner (exit 1 on untracked corruption outside the tooling allowlist).
5. Regression tests wired into the repo test suite (`npm test` green).

## 5. DB repair procedure (if corrupted records are found)

The committed content was the confirmed corruption site; if users report corrupted **stored** notes/transcripts, use the dry-run process (implemented in `scripts/repair-mojibake.mjs --db --dry-run`):

1. **Identify:** scan `notes`, `transcripts`, and related text columns for signature sequences; report affected record IDs and column counts.
2. **Preserve:** copy each affected row's original value to a `*_pre_repair` backup table (or a JSONL backup file) before any write.
3. **Repair confidently:** apply `repairMojibake()` only where the repaired value differs and the result contains no residual signature.
4. **Ambiguous cases:** records where repair produces a value still containing signatures, or where multiple repair interpretations exist, are **listed, not modified** — human review required.
5. **Rollback:** restore from the backup table/JSONL; the repair is never applied without a backup row.
6. **No double-decoding:** `repairMojibake` is idempotent — running it on already-correct text is a no-op, and it never applies the same double-decode twice (verified by the pass-through regression tests).

## 6. Prevention

- **Guard test in the suite:** any future commit that reintroduces mojibake into tracked sources fails `npm test`.
- **Agent-environment rule (recorded for all future sessions):** never read/write repo files with PowerShell 5.1 content cmdlets (`Get-Content`/`Set-Content`) — use the UTF-8-safe editing tools or .NET `UTF8Encoding($false)`. This is the single confirmed generator of the corruption.
- **Scanner available for CI:** `scripts/mojibake-scan.mjs` can be added to the security workflow if desired (currently the test-suite guard covers tracked files).

## 7. What was NOT changed

- Correctly encoded text is untouched (regression-verified).
- No runtime re-encoding layer was added to the app — the corruption was in source data, not the pipeline.
- No database rows were modified (none were confirmed corrupted at fix time; the dry-run tool is ready if any are found).
