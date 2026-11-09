# Detailed Notes — Primary Quality Metrics (summary)

Headline results from `node --experimental-strip-types scripts/evaluate-notes-quality.mts`
(the full point/claim breakdown is written locally to `evaluations/quality-report.{md,json}`, which
carry the sample recordings' verbatim content and are therefore gitignored).

## Methodology (recording-agnostic)

Two independent quality measures, plus a deterministic evidence layer:

1. **Semantic completeness (recall)** — an LLM judge extracts the transcript's substantive points
   (topics, arguments, facts, questions, conclusions), then judges each as `covered` / `partial` /
   `not_covered` against the generated notes. Recall = `(covered + 0.5·partial) / total`.
2. **Factual faithfulness** — an LLM judge extracts the notes' factual claims, then judges each as
   `supported` / `partially_supported` / `unsupported` against the transcript (detects invented or
   over-interpreted content). Faithfulness = `(supported + 0.5·partial) / total`.
3. **Evidence verification (deterministic)** — every detailed-section `quote` is checked verbatim
   against the transcript (`faithfulness.ts`), and its recorded `quote_ms` is compared to where the
   words were actually said. This is a lower bound on faithfulness that needs no model and never
   varies.

Literal keyword recall is **not** a quality metric — it is kept only as a limited diagnostic in
`evaluations/coverage-report.md`.

## Sample results (the two reviewed recordings; LLM judge, so ± a few points run to run)

| Recording | Semantic recall | Factual faithfulness | Quote grounding |
| --- | --- | --- | --- |
| Baba Vanga Prophecies Analysis | ~99% (59/60) | ~100% (55/55) | 100% (14/14) |
| Philosophical Discussion on Technology and Origins | ~100% (27/27) | ~94% (21/24) | 71% (5/7; 2 quotes paraphrased) |

Notable findings the evaluator surfaced on the philosophical sample:

- One `unsupported` claim: the notes asserted alien contact "will fundamentally alter our
  understanding of reality and our place in the cosmos" — the transcript does not say this.
- Several `partially_supported` claims: the notes added "extraterrestrial or interdimensional" where
  the transcript only says "intelligent beings that are not within this space".
- Two `not_covered` points were transcription artifacts ("drones … choreographed to tell stories"),
  not substantive content the notes failed to capture.
- Two `ungrounded` quotes were paraphrases rather than verbatim excerpts.

These are evaluation results on two samples used for regression, not a per-recording guarantee; the
generator and the evaluator are both recording-agnostic.