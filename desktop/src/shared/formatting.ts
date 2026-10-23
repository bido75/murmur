// Cleaning up what was said.
//
// A dictation is read out loud, so it comes out with no capital letters, no full
// stops and the wrong spacing. These are the rules that put it right, and a place
// for the user's own rules.
//
// The rules here are careful with numbers and with anything that looks like a
// measurement: a dose, an amount of money or a measurement must not be changed by
// accident, because getting it wrong matters more than a stray full stop.

/** How a rule finds what it replaces. */
export type MatchMode = "smart" | "exact" | "regex";

export type FormattingRule = {
  id: string;
  /** What to look for. */
  trigger: string;
  /** What to put in its place. */
  replacement: string;
  enabled: boolean;
  mode: MatchMode;
  /** A name for the user, when the trigger is not a good name. */
  name?: string;
};

/** The built-in settings, which are not rules the user writes. */
export type BuiltInOptions = {
  /** Words this many or fewer are treated as a short note. */
  shortTextThreshold: number;
  /** Put a space before a question mark or an exclamation mark. */
  spaceBeforePunctuation: boolean;
  /** Leave a space at the end, so the next thing is not stuck to it. */
  trailingSpace: boolean;
  /** Turn spoken numbers into digits. */
  convertNumbers: boolean;
  /** Leave out "um", "uh" and the like. */
  removeHesitations: boolean;
  /** Start each sentence with a capital. */
  capitaliseSentences: boolean;
};

export const DEFAULT_BUILT_INS: BuiltInOptions = {
  shortTextThreshold: 3,
  spaceBeforePunctuation: false,
  trailingSpace: true,
  convertNumbers: false,
  removeHesitations: false,
  capitaliseSentences: true,
};

/** The sounds people make while they think. */
const HESITATIONS = /\b(euh+|um+|uh+|erm+|hmm+)\b/gi;

/**
 * Check a rule before it is used.
 *
 * A broken pattern would throw every time a transcript is cleaned, so it is caught
 * here and the rule is refused.
 */
export function validateRule(rule: FormattingRule): {
  ok: boolean;
  reason?: string;
} {
  if (!rule.trigger.trim()) return { ok: false, reason: "The rule needs something to look for." };
  if (rule.mode === "regex") {
    try {
      // eslint-disable-next-line no-new
      new RegExp(rule.trigger);
    } catch (e) {
      return {
        ok: false,
        reason: `That pattern is not valid: ${(e as Error).message}`,
      };
    }
  }
  if (rule.replacement.length > 2000)
    return { ok: false, reason: "That replacement is too long." };
  return { ok: true };
}

/**
 * A pattern that will not run away.
 *
 * A pattern that matches nothing is useless; one that matches everything and
 * replaces it with a long string would make the transcript unreadable. The rules are
 * applied to text that is not enormous, and each rule is applied once.
 */
export function ruleIsSafe(rule: FormattingRule, sample: string): boolean {
  if (rule.mode !== "regex") return true;
  let pattern: RegExp;
  try {
    pattern = new RegExp(rule.trigger, "g");
  } catch {
    return false;
  }
  const matches = sample.match(pattern);
  if (!matches) return false;
  // A pattern that matches the whole sample, or most of it, is not a useful rule.
  const covered = matches.reduce((total, m) => total + m.length, 0);
  if (covered > sample.length / 2) return false;
  return matches.length <= sample.length / 2 + 1;
}

/** Escape the characters that mean something in a pattern. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply one rule.
 *
 * The three kinds of rule do different things:
 *
 * - "exact" is a plain search: it is case sensitive and it replaces the first
 *   match wherever it is.
 * - "regex" is the user's own pattern, with `$1` and `$2` for the groups.
 * - "smart" is like "exact" but it ignores the case and it keeps the punctuation
 *   around the match, so "colour" at the end of a sentence stays "colour.".
 */
export function applyRule(text: string, rule: FormattingRule): string {
  if (!rule.enabled || !rule.trigger) return text;
  if (rule.mode === "exact") return text.replace(rule.trigger, rule.replacement);
  if (rule.mode === "regex") {
    try {
      return text.replace(new RegExp(rule.trigger, "g"), rule.replacement);
    } catch {
      // A broken pattern leaves the text alone rather than losing it.
      return text;
    }
  }
  // Smart: case does not matter, and the punctuation around the match is kept.
  const pattern = new RegExp(
    `([,\\.]\\s|\\s)?${escapeRegExp(rule.trigger)}([,\\.]?)`,
    "i",
  );
  return text.replace(
    pattern,
    (_match, prefix: string | undefined, trailing: string | undefined) => {
      const keep = prefix ?? "";
      // A "$" in the replacement is a literal, not a group reference.
      let out = rule.replacement.replace(/\$/g, "$$$$");
      const tail = trailing ?? "";
      // The punctuation that was there is put back, unless the replacement already
      // ends with some.
      if (tail && !/[,.!?]$/.test(out)) out += tail;
      return `${keep}${out}`;
    },
  );
}

/**
 * Apply the rules in the order the user put them in.
 *
 * The order matters: a rule that changes one thing may make another rule match, and
 * the user decides which happens first.
 */
export function applyRules(
  text: string,
  rules: FormattingRule[],
): string {
  let out = text;
  for (const rule of rules) out = applyRule(out, rule);
  return out;
}

/**
 * Put the spaces right before a question mark or an exclamation mark.
 */
export function spaceBeforePunctuation(text: string): string {
  return text.replace(/([^\s\d!?])([?!])/g, "$1 $2");
}

/**
 * Make the first letter of a sentence capital.
 *
 * A word that is meant to keep its own capitals is left alone: "API" is an acronym
 * and "iPhone" has a capital in the middle, so neither is touched.
 */
export function capitaliseSentences(text: string): string {
  return text.replace(
    /(^|[.!?]\s+)([a-z])(\p{L})/gu,
    (match, before: string, first: string, second: string) => {
      // A lower-case second letter means the word has a capital of its own.
      if (second !== second.toLowerCase()) return match;
      return `${before}${first.toUpperCase()}${second}`;
    },
  );
}

/**
 * Take out the sounds people make while they think.
 *
 * The words are left in place if removing them would leave the sentence empty.
 */
export function removeHesitations(text: string): string {
  const out = text.replace(HESITATIONS, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Fix the spacing: one space between words, no space before a full stop.
 */
export function normaliseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Make a short note read like a note rather than a sentence.
 *
 * A word or two that was dictated is not a sentence, so it loses its full stop and
 * its capital: "Hello." reads as "hello." Words that are meant to have capitals are
 * left alone — "API" is an acronym and "iPhone" has a capital of its own.
 */
export function shortenText(text: string, threshold: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > threshold) return text;
  const out = words
    .map((w) => {
      const bare = w.replace(/[.,!?;:]+$/, "");
      const tail = w.slice(bare.length);
      if (!bare.length) return w;
      // "API" and "OK": every letter is a capital.
      if (bare.length > 1 && bare === bare.toUpperCase()) return w;
      // "iPhone" and "I": the word has a capital of its own, so it is left alone.
      if (bare.length > 1 && bare[1] !== bare[1].toLowerCase()) return w;
      // "Hello": one capital and the rest lower, so the capital comes off.
      if (bare.length > 1 && bare[0] === bare[0].toUpperCase())
        return bare[0].toLowerCase() + bare.slice(1) + tail;
      return bare + tail;
    })
    .join(" ");
  return out.replace(/[.!?]+$/, "");
}

/**
 * Apply the built-in settings.
 */
export function applyBuiltIns(
  text: string,
  options: BuiltInOptions = DEFAULT_BUILT_INS,
): string {
  let out = text;
  if (options.removeHesitations) out = removeHesitations(out);
  if (options.spaceBeforePunctuation) out = spaceBeforePunctuation(out);
  if (options.capitaliseSentences) out = capitaliseSentences(out);
  out = normaliseWhitespace(out);
  if (options.shortTextThreshold > 0)
    out = shortenText(out, options.shortTextThreshold);
  if (options.trailingSpace && !/[ \n]$/.test(out)) out += " ";
  return out;
}

/**
 * The whole clean-up: the user's rules, then the built-in settings.
 *
 * The order is fixed so the result is the same every time.
 */
export function formatTranscript(
  text: string,
  rules: FormattingRule[] = [],
  options: BuiltInOptions = DEFAULT_BUILT_INS,
): string {
  const withRules = applyRules(text, rules);
  return applyBuiltIns(withRules, options);
}
