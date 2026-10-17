// Phone calls through a Murmur number (Twilio), and Aircall call imports. Pure; tested.

const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}

/** Twilio's X-Twilio-Signature: base64 HMAC-SHA1 of the full URL followed by each POST param (sorted) as key+value. */
export async function twilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const key = await crypto.subtle.importKey('raw', enc.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

export async function verifyTwilio(authToken: string, url: string, params: Record<string, string>, header: string | null): Promise<boolean> {
  if (!authToken || !header) return false;
  const expected = await twilioSignature(authToken, url, params);
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

/**
 * Digits typed on the keypad → E.164. 10 digits are taken as US/Canada; otherwise the caller types
 * the country code first. Returns null for anything that isn't a plausible number.
 */
export function keypadToE164(digits: string, defaultCountry = '1'): string | null {
  const d = (digits ?? '').replace(/[^0-9]/g, '');
  if (defaultCountry === '1' && d.length === 10 && /^[2-9]/.test(d)) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1') && defaultCountry === '1') return `+${d}`;
  if (d.startsWith('011') && d.length >= 10) return `+${d.slice(3)}`; // US international prefix
  if (d.length >= 8 && d.length <= 15 && /^[1-9]/.test(d)) return `+${d}`;
  return null;
}

/** Only call places we've allowed (stops toll fraud to premium numbers). PHONE_ALLOWED_PREFIXES="+1,+44". */
export function callAllowed(e164: string, allowed: string | undefined): boolean {
  const list = (allowed ?? '+1').split(',').map((s) => s.trim()).filter((s) => /^\+[0-9]+$/.test(s));
  // North America: block premium 900 and 976 exchanges.
  if (/^\+1(900|976)/.test(e164)) return false;
  return list.some((p) => e164.startsWith(p));
}

export function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Spoken digits for the caller ("+15125550123" → "5 1 2, 5 5 5, 0 1 2 3"). */
export function spokenNumber(e164: string): string {
  const d = e164.replace(/^\+1/, '').replace(/^\+/, '');
  return d.length === 10 ? `${d.slice(0, 3).split('').join(' ')}, ${d.slice(3, 6).split('').join(' ')}, ${d.slice(6).split('').join(' ')}` : d.split('').join(' ');
}

const say = (text: string) => `<Say voice="Polly.Joanna">${xml(text)}</Say>`;
const twiml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

export const PHONE_TEXT = {
  announce: 'This call is being recorded with Murmur to take notes.',
};

export function twimlReject(message: string): string {
  return twiml(`${say(message)}<Hangup/>`);
}

export function twimlAskPin(action: string, appName: string, retry = false): string {
  return twiml(
    `<Gather input="dtmf" numDigits="8" finishOnKey="#" timeout="8" action="${xml(action)}" method="POST">` +
      say(retry ? 'That PIN was not right. Enter your PIN, then press pound.' : `${appName}. Enter your call PIN, then press pound.`) +
      `</Gather>${say('Goodbye.')}<Hangup/>`,
  );
}

export function twimlAskNumber(action: string, retry = false): string {
  return twiml(
    `<Gather input="dtmf" numDigits="16" finishOnKey="#" timeout="12" action="${xml(action)}" method="POST">` +
      say(retry ? 'That number did not work. Enter the number to call, then press pound.' : 'Enter the number to call, including the area code, then press pound.') +
      `</Gather>${say('Goodbye.')}<Hangup/>`,
  );
}

/**
 * Bridge the call and record both sides (one channel each). The person called hears the
 * recording notice as soon as they answer; the caller hears it before dialing.
 */
export function twimlDial(opts: { to: string; callerId: string; announceUrl: string; recordingCallback: string; timeLimitSec?: number }): string {
  return twiml(
    say(`${PHONE_TEXT.announce} Calling ${spokenNumber(opts.to)}.`) +
      `<Dial callerId="${xml(opts.callerId)}" record="record-from-answer-dual" timeLimit="${opts.timeLimitSec ?? 14400}" ` +
      `recordingStatusCallback="${xml(opts.recordingCallback)}" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST">` +
      `<Number url="${xml(opts.announceUrl)}" method="POST">${xml(opts.to)}</Number></Dial>`,
  );
}

/** Played to the person called, before they're connected. */
export function twimlAnnounce(): string {
  return twiml(say(PHONE_TEXT.announce));
}

// ---------- Aircall ----------

export type AircallCall = {
  id: string;
  direction: 'inbound' | 'outbound' | null;
  startedAt: string | null;
  durationSec: number;
  recordingUrl: string | null;
  otherParty: string | null;
  contactName: string | null;
  userEmail: string | null;
};

/** The parts of an Aircall `call.*` webhook we use. The token is Aircall's per-webhook secret. */
export function parseAircall(body: unknown): { event: string; token: string | null; call: AircallCall | null } {
  const b = (body ?? {}) as Record<string, unknown>;
  const d = (b.data ?? null) as Record<string, unknown> | null;
  const contact = (d?.contact ?? null) as { first_name?: string; last_name?: string; company_name?: string } | null;
  const name = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.company_name || null : null;
  const call: AircallCall | null =
    d && d.id != null
      ? {
          id: String(d.id),
          direction: d.direction === 'inbound' || d.direction === 'outbound' ? d.direction : null,
          startedAt: typeof d.started_at === 'number' ? new Date(d.started_at * 1000).toISOString() : null,
          durationSec: Number(d.duration ?? 0) || 0,
          recordingUrl: typeof d.recording === 'string' && /^https:\/\//.test(d.recording) ? d.recording : null,
          otherParty: typeof d.raw_digits === 'string' ? d.raw_digits : null,
          contactName: name,
          userEmail: ((d.user ?? null) as { email?: string } | null)?.email ?? null,
        }
      : null;
  return { event: String(b.event ?? ''), token: typeof b.token === 'string' ? b.token : null, call };
}

export function aircallTitle(c: AircallCall): string {
  const who = c.contactName || c.otherParty || 'unknown number';
  return `${c.direction === 'inbound' ? 'Call from' : 'Call with'} ${who}`.slice(0, 120);
}
