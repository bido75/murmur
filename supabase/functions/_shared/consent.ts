// Recording-consent rules by US state, for warnings in the app. Pure, unit-tested; the app
// imports this file too. Information, not legal advice: laws change and have exceptions.
// Source: state-by-state summaries current as of Oct 2026 (see README); have counsel review.

export type Rule = 'all_party' | 'one_party';
export type StateLaw = { code: string; name: string; rule: Rule; note?: string; phoneOnly?: boolean; inPersonOnly?: boolean };

/** States that require everyone's consent (fully or partly). Every other state is one-party. */
const ALL_PARTY: StateLaw[] = [
  { code: 'CA', name: 'California', rule: 'all_party', note: 'Applies to confidential conversations, including calls with someone in California.' },
  { code: 'CT', name: 'Connecticut', rule: 'all_party', phoneOnly: true, note: 'Phone calls need everyone’s consent.' },
  { code: 'DE', name: 'Delaware', rule: 'all_party', note: 'Statutes conflict; treat as everyone’s consent.' },
  { code: 'FL', name: 'Florida', rule: 'all_party' },
  { code: 'IL', name: 'Illinois', rule: 'all_party', note: 'Applies to private conversations.' },
  { code: 'MD', name: 'Maryland', rule: 'all_party' },
  { code: 'MA', name: 'Massachusetts', rule: 'all_party' },
  { code: 'MT', name: 'Montana', rule: 'all_party' },
  { code: 'NV', name: 'Nevada', rule: 'all_party', phoneOnly: true, note: 'Phone calls need everyone’s consent; in-person rules are debated.' },
  { code: 'NH', name: 'New Hampshire', rule: 'all_party' },
  { code: 'OR', name: 'Oregon', rule: 'all_party', inPersonOnly: true, note: 'In-person conversations need everyone’s consent; phone calls are one-party.' },
  { code: 'PA', name: 'Pennsylvania', rule: 'all_party' },
  { code: 'WA', name: 'Washington', rule: 'all_party', note: 'An announcement that the call is recorded counts as notice.' },
];

const OTHERS: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CO', 'Colorado'], ['DC', 'District of Columbia'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'],
  ['LA', 'Louisiana'], ['ME', 'Maine'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['NE', 'Nebraska'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'],
  ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'],
  ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

export const STATES: StateLaw[] = [
  ...ALL_PARTY,
  ...OTHERS.map(([code, name]): StateLaw => ({ code, name, rule: 'one_party', ...(code === 'MI' ? { note: 'Generally one-party for participants; the statute is disputed.' } : {}) })),
].sort((a, b) => a.name.localeCompare(b.name));

export function stateByCode(code: string | null | undefined): StateLaw | null {
  return STATES.find((s) => s.code === code) ?? null;
}

export type Kind = 'phone' | 'in_person' | 'online';
export type Advice = { level: 'everyone' | 'notice' | 'unknown'; title: string; body: string; states: string[] };

/** Does this state's all-party rule apply to this kind of conversation? */
function strict(s: StateLaw, kind: Kind): boolean {
  if (s.rule !== 'all_party') return false;
  if (s.phoneOnly) return kind === 'phone' || kind === 'online';
  if (s.inPersonOnly) return kind === 'in_person';
  return true;
}

/**
 * What to tell the user before recording, given where they are and (for calls) where the
 * other people are. The strictest place wins. "Outside the US" or unknown → be safe.
 */
export function consentAdvice(myState: string | null, otherStates: (string | null)[], kind: Kind): Advice {
  const places = [myState, ...otherStates];
  const unknown = places.some((p) => !p || p === 'OTHER');
  const strictOnes = places.map(stateByCode).filter((s): s is StateLaw => !!s && strict(s, kind));
  const names = [...new Set(strictOnes.map((s) => s.name))];
  if (names.length) {
    return {
      level: 'everyone',
      title: 'Everyone must agree to be recorded',
      body: `${names.join(', ')} ${names.length > 1 ? 'require' : 'requires'} consent from every person ${kind === 'phone' ? 'on the call' : 'in the conversation'}. Ask and get a yes before recording, or send the consent link.`,
      states: names,
    };
  }
  if (unknown) {
    return {
      level: 'unknown',
      title: 'Ask everyone first',
      body: 'Some people may be in a place that requires everyone’s consent (several US states, and many countries, including in the EU). The safe choice is to ask everyone and get a yes before recording.',
      states: [],
    };
  }
  return {
    level: 'notice',
    title: 'Telling people is still the right thing to do',
    body: 'Where everyone is, one person’s consent is enough under state law, but letting people know builds trust and some workplaces require it.',
    states: [],
  };
}
