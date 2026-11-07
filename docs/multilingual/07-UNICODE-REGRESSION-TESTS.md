# 07 — Unicode Regression Tests

**Status:** Implemented and passing in the repo test suite.
**Date:** 2026-10-30
**Location:** `src/lib/mojibake.test.ts` (runs with `npm test`)

## Test inventory

### 1. Repair completeness (22 observed sequences)
Every mojibake sequence observed in the Android screenshots has a dedicated assertion:

| Input (mojibake) | Expected output |
|---|---|
| `â€¢` | • (U+2022) |
| `â€¦` | … (U+2026) |
| `Â·` | · (U+00B7) |
| `â€”` | — (U+2014) |
| `â€“` | – (U+2013) |
| `â€˜` / `â€™` | ' / ' (U+2018/U+2019) |
| `â€œ` / `â€` | “ / ” (U+201C/U+201D) |
| `Â©`, `Â®`, `Â°`, `Â±`, `Â½`, `Â«`, `Â»`, `Â¡`, `Â¿` | © ® ° ± ½ « » ¡ ¿ |
| `Ã©`-style accented doubles | é è ê ë etc. |
| `Ã§`, `Ã±`, `Ã¼`, `Ã¶`, `Ã¤`, `Ã¶`, `ÃŸ` | ç ñ ü ö ä ß |

### 2. Idempotence / no double-decoding
- Applying `repairMojibake()` to **already-correct** text returns it byte-identical (asserted for every repaired sample and for plain ASCII).
- Applying it **twice** to mojibake input yields the same single-pass result (no second decode).

### 3. Multilingual pass-through (must never be altered)
Samples in the following languages round-trip through `repairMojibake()` unchanged — proving the repairer never corrupts correctly encoded text:

- **Arabic:** مرحبا بالعالم — كيف حالك اليوم؟
- **Chinese (Simplified):** 你好，世界。今天天气很好。
- **Japanese:** こんにちは世界。元気ですか。
- **Hindi:** नमस्ते दुनिया। आप कैसे हैं?
- **Swahili:** Habari ya dunia! Habari yako?
- **Amharic:** ሰላም ልዑል። እንዴት ነህ?
- **Twi (Akan):** ɛte sɛn? Ɛyɛ sɛnea wopɛ no.
- **Yoruba:** Báwo ni? Ẹ kú àárọ̀.
- **Georgian:** გამარჯობა, როგორ ხარ?
- **Armenian:** Բարև Ձեզ, ինչպե՞ս եք:
- **Accented Latin:** Café naïve résumé — Zürich, São Paulo, İstanbul
- **Mixed punctuation:** “Curly quotes” … em-dash • bullet • ellipsis · middot

### 4. Repo-wide guard test
A test iterates all tracked text files (via `git ls-files`, excluding the mojibake tooling files themselves which legitimately contain signature literals) and **fails** if any file contains the CP1252 double-encoding signatures. This prevents reintroduction at commit time.

### 5. Export/bundle verification (manual + scripted)
- `scripts/mojibake-scan.mjs` — scans a directory (e.g. `dist-web`) at byte level; used to verify exported bundles.
- Verified on the rebuilt `dist-web`: **42 files, 0 mojibake hits**, new UX strings present, served live at `https://notes.giscop.com`.

## Multilingual coverage rationale

The pass-through samples deliberately span:
- **Scripts:** Latin (extended), Arabic, Devanagari, CJK, Ge'ez (Ethiopic), Georgian, Armenian — covering the writing systems named in the remediation prompt plus West African (Twi/Yoruba) diacritics (ɛ, ɔ, Ẹ, àárọ̀).
- **Directionality:** Arabic sample establishes that repair must not reorder or normalize RTL text (asserted byte-identical).
- **Tone/diacritic density:** Yoruba/Twi samples include combining diacritics (Ẹ = E+U+0323, àárọ̀) — the most easily corrupted class.

## Running

```
npm test            # includes mojibake.test.ts
node scripts/mojibake-scan.mjs dist-web   # byte-level bundle check (exit 1 on hits)
```

## Results (2026-10-30)

- `npm test`: **pass** (0 failed, 0 cancelled).
- `scripts/mojibake-scan.mjs` on repo tracked files: only the tooling files themselves flagged (expected).
- `scripts/mojibake-scan.mjs` on `dist-web`: **0 files with mojibake** out of 42.
