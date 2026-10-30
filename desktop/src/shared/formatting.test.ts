import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuiltIns,
  applyRule,
  applyRules,
  capitaliseSentences,
  formatTranscript,
  normaliseWhitespace,
  removeHesitations,
  ruleIsSafe,
  shortenText,
  spaceBeforePunctuation,
  validateRule,
  type FormattingRule,
} from './formatting.ts';

function rule(over: Partial<FormattingRule> = {}): FormattingRule {
  return {
    id: "r1",
    trigger: "colour",
    replacement: "color",
    enabled: true,
    mode: "smart",
    ...over,
  };
}

test('a rule is checked before it is used', () => {
  assert.equal(validateRule(rule()).ok, true);
  assert.equal(validateRule(rule({ trigger: "" })).ok, false);
  assert.equal(validateRule(rule({ mode: "regex", trigger: "([unclosed" })).ok, false);
  assert.match(
    validateRule(rule({ mode: "regex", trigger: "([unclosed" })).reason ?? "",
    /not valid/,
  );
});

test('a pattern that matches everything is refused', () => {
  assert.equal(ruleIsSafe(rule({ mode: "regex", trigger: ".*" }), "one two three"), false);
  assert.equal(ruleIsSafe(rule({ mode: "regex", trigger: "two" }), "one two three"), true);
});

test('an exact rule is a plain, case sensitive search', () => {
  assert.equal(applyRule("the colour is red", rule({ mode: "exact" })), "the color is red");
  assert.equal(
    applyRule("the Colour is red", rule({ mode: "exact" })),
    "the Colour is red",
    "an exact rule does not ignore the case",
  );
});

test('a smart rule ignores the case and keeps the punctuation', () => {
  assert.equal(applyRule("the Colour is red", rule()), "the color is red");
  assert.equal(
    applyRule("the colour, and more", rule()),
    "the color, and more",
    "the comma and the space around the match are kept",
  );
  assert.equal(
    applyRule("the colour.", rule()),
    "the color.",
    "the full stop after the match is kept",
  );
});

test('a regular expression rule can use the groups', () => {
  // The pattern matches every pair of words, so every pair is swapped round.
  assert.equal(
    applyRule("call John Smith now", rule({ mode: "regex", trigger: "(\\w+) (\\w+)", replacement: "Mr $2 $1" })),
    "Mr John call Mr now Smith",
  );
});

test('a broken pattern leaves the text alone rather than losing it', () => {
  assert.equal(applyRule("some text", rule({ mode: "regex", trigger: "([unclosed" })), "some text");
});

test('the rules are applied in the order they are given', () => {
  const rules = [
    rule({ id: "a", trigger: "one", replacement: "two", mode: "exact" }),
    rule({ id: "b", trigger: "two", replacement: "three", mode: "exact" }),
  ];
  assert.equal(applyRules("one", rules), "three", "the second rule sees the first one's work");
});

test('a space is put before a question mark', () => {
  assert.equal(spaceBeforePunctuation("what now?"), "what now ?");
  assert.equal(spaceBeforePunctuation("what now ?"), "what now ?", "it does not double it");
});

test('sentences start with a capital, but names in capitals are left alone', () => {
  assert.equal(capitaliseSentences("the meeting. the API is here."), "The meeting. The API is here.");
  assert.equal(capitaliseSentences("iPhone and API"), "iPhone and API");
});

test('the sounds people make while thinking are left out', () => {
  assert.equal(removeHesitations("I um think so"), "I think so");
  assert.equal(removeHesitations("euh the answer"), "the answer");
});

test('the spacing is put right', () => {
  assert.equal(normaliseWhitespace("hello   world  ."), "hello world.");
  assert.equal(normaliseWhitespace("one\n\n\n\ntwo"), "one\n\ntwo");
});

test('a short note loses its full stop and its capital', () => {
  assert.equal(shortenText("hello.", 3), "hello");
  assert.equal(shortenText("Hello.", 3), "hello", "a note is not a sentence");
  assert.equal(shortenText("API.", 3), "API", "an acronym keeps its capitals");
  assert.equal(shortenText("iPhone.", 3), "iPhone", "a word with its own capital is left alone");
  assert.equal(shortenText("one two three four", 3), "one two three four", "a long note is left alone");
});

test('the whole clean-up keeps the words and fixes the shape', () => {
  const out = formatTranscript("euh the meeting  . we agreed on the budget", [], {
    shortTextThreshold: 3,
    spaceBeforePunctuation: false,
    trailingSpace: true,
    convertNumbers: false,
    removeHesitations: true,
    capitaliseSentences: true,
  });
  assert.match(out, /The meeting/);
  assert.match(out, /we agreed on the budget/i);
  assert.ok(out.endsWith(" "), "it leaves a space at the end");
});

test('the built-in settings can be left out one at a time', () => {
  const text = "hello world";
  assert.equal(
    applyBuiltIns(text, {
      shortTextThreshold: 0,
      spaceBeforePunctuation: false,
      trailingSpace: false,
      convertNumbers: false,
      removeHesitations: false,
      capitaliseSentences: false,
    }),
    "hello world",
    "with everything off the text is left alone",
  );
});
