# 11 — African Language Registry

**Status:** Implemented in the shared registry (`supabase/functions/_shared/languages.ts`); per-language quality verification pending.
**Date:** 2026-10-30

All five African regions are represented in the registry with BCP-47/ISO-639 codes, script, direction, and region metadata. Ghanaian languages receive explicit priority (see `12-GHANAIAN-LANGUAGE-COVERAGE.md`).

## Registry entries by region

### North Africa
| Code | English name | Native | Script | Dir | Regions | Tier |
|---|---|---|---|---|---|---|
| ar | Arabic | العربية | Arab | rtl | SA, EG, MA, DZ, AE | production (transcription too) |
| ar-DZ | Algerian Arabic | | Arab | rtl | DZ | production |
| ar-MA | Moroccan Arabic (Darija) | | Arab | rtl | MA | production |
| ar-EG | Egyptian Arabic | مصري | Arab | rtl | EG | production |
| ar-TN | Tunisian Arabic | | Arab | rtl | TN | production |
| ber | Tamazight (Berber) | | Tfng | ltr | DZ, MA | production |
| kab | Kabyle | | Latn | ltr | DZ | production |
| shi | Tachelhit | | Tfng | ltr | MA | production |

### West Africa
| Code | English name | Native | Script | Regions | Tier |
|---|---|---|---|---|---|---|
| ha | Hausa | Hausa | Latn | NG, NE, GH | production |
| yo | Yoruba | Yorùbá | Latn | NG, BJ | production |
| ig | Igbo | Igbo | Latn | NG | production |
| ff | Fula (Fulfulde) | Fulfulde | Latn | SN, GN, ML, NG, CM | production |
| ak | Twi (Akan) | Akan | Latn | GH | production |
| ee | Ewe | Eʋegbe | Latn | GH, TG | production |
| gaa | Ga | Gã | Latn | GH | production |
| wo | Wolof | Wolof | Latn | SN, GM | production |
| bm | Bambara | Bamanankan | Latn | ML | production |
| mos | Moore | | Latn | BF | production |
| fon | Fon | | Latn | BJ | production |
| dag | Dagbani | | Latn | GH | **experimental** |
| ada | Dangme | | Latn | GH | **experimental** |
| dga | Dagaare | | Latn | GH | **experimental** |
| kac | Kasem | | Latn | GH, BF | **experimental** |
| kus | Kusaal | | Latn | GH, BF | **experimental** |
| gur | Gurene (Frafra) | | Latn | GH | **experimental** |
| mpm | Mampruli | | Latn | GH | **experimental** |
| gjn | Gonja | | Latn | GH | **experimental** |
| nzi | Nzema | | Latn | GH, CI | **experimental** |

### East Africa
sw (Kiswahili), am (አማርኛ, Ethiopic), om (Afaan Oromoo), ti (ትግርኛ, Ethiopic), so (Soomaali), rw (Ikinyarwanda), rn (Ikirundi), lg (Luganda), ki (Gĩkũyũ), luo (Dholuo), mg (Malagasy) — all production tier.

### Central Africa
ln (Lingala), kg (Kikongo), sg (Sango), lua (Tshiluba), fan (Fang) — all production tier.

### Southern Africa
af (Afrikaans), zu (isiZulu), xh (isiXhosa), sn (chiShona), st (Sesotho), tn (Setswana), ts (Xitsonga), ve (Tshivenda), ss (Swati), nd (Ndebele), ny (Chichewa), bem (IciBemba) — all production tier.

## What is verified vs not

- **Verified live (2026-10-30):** English → Twi translation through the configured provider (correct tone vowels ɛ/ɔ, natural phrasing). Swahili and Yoruba were reported verified in an earlier audit but the evidence is not reproduced in this session — status recorded as "previously reported, re-verification pending".
- **Same mechanism, unverified:** every other production-tier language uses the identical provider path; per-language quality is unknown until the capability-matrix script runs.
- **Experimental tier:** the LLM will attempt translation but output quality in these languages is not established. UI labels them "(experimental)". They are **never** marked transcription-capable.
- **Transcription:** only the 31 production-tier STT-list languages carry `transcription: true`. No African language is claimed transcription-capable unless the STT provider (Mistral Voxtral) documents it — verification scheduled (see `14-AFRICAN-LANGUAGE-PROVIDER-MATRIX.md`).

## Backlog (not in the registry yet)

- **Sisaala** — ISO-639-3 code requires verification (Tumul Sisaala vs Palaba Sisaala are distinct entries) before a registry row is added.
- Additional Ghanaian varieties (per the linguistic sources listed in `12-GHANAIAN-LANGUAGE-COVERAGE.md`) enter the registry through the same verified-code process.
- Code-switching (Ghanaian English + Twi/Ewe/Ga in one recording) is tracked in `13-AFRICAN-DIALECTS-AND-CODE-SWITCHING.md`.
