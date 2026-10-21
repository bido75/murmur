// The plan and the minutes. The server decides everything; this file asks the server and
// turns the answer into plain words for the app.
import { supabase } from './supabase';

export type BillingPlan = 'free' | 'paid';
export type BillingPeriod = 'monthly' | 'yearly';

export type Billing = {
  /** The paywall is switched on by the server. When it is off, the app behaves as before. */
  paywall: boolean;
  plan: BillingPlan;
  period: BillingPeriod;
  minutesIncluded: number;
  minutesUsed: number;
  minutesLeft: number;
  /** Past 80% of the minutes: tell the user before they run out. */
  warn: boolean;
  /** No minutes left in this period. */
  overLimit: boolean;
  currentPeriodEnd: string;
  cancelAt: string | null;
  provider: 'none' | 'stripe' | 'revenuecat';
  /** The server can take a payment. */
  canBuy: boolean;
  /** Recordings whose notes are waiting. */
  waiting: number;
};

type BillingResponse = {
  paywall: boolean;
  plan: string;
  period: string;
  minutes_included: number;
  minutes_used: number;
  minutes_left: number;
  warn: boolean;
  over_limit: boolean;
  current_period_end: string;
  cancel_at: string | null;
  provider: string;
  can_buy: boolean;
  waiting: number;
};

/** The plan on the server, or null if the server could not be asked. */
export async function getBilling(): Promise<Billing | null> {
  const { data, error } = await supabase.functions.invoke('billing');
  if (error || !data) return null;
  const b = data as BillingResponse;
  return {
    paywall: Boolean(b.paywall),
    plan: b.plan === 'paid' ? 'paid' : 'free',
    period: b.period === 'yearly' ? 'yearly' : 'monthly',
    minutesIncluded: Number(b.minutes_included ?? 0),
    minutesUsed: Number(b.minutes_used ?? 0),
    minutesLeft: Number(b.minutes_left ?? 0),
    warn: Boolean(b.warn),
    overLimit: Boolean(b.over_limit),
    currentPeriodEnd: b.current_period_end ?? '',
    cancelAt: b.cancel_at ?? null,
    provider: (b.provider === 'stripe' || b.provider === 'revenuecat' ? b.provider : 'none') as Billing['provider'],
    canBuy: Boolean(b.can_buy),
    waiting: Number(b.waiting ?? 0),
  };
}

/** A link to buy a plan. The server creates it. */
export async function buyPlan(period: BillingPeriod = 'monthly'): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('billing/checkout', { body: { period } });
  if (error) throw new Error((error as { message?: string }).message ?? 'Could not start the purchase.');
  return (data as { url?: string } | null)?.url ?? null;
}

/** Cancel the plan. It stays until the end of the period that is paid for. */
export async function cancelPlan(): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('billing/cancel', { body: {} });
  if (error) throw new Error((error as { message?: string }).message ?? 'Could not cancel the plan.');
  return (data as { ends_on?: string } | null)?.ends_on ?? null;
}

/** The recordings whose notes are waiting, so the app can say so on each one. */
export async function waitingRecordings(): Promise<string[]> {
  // The same filter the server uses: a recording that is ready is not waiting any more.
  const { data } = await supabase.from('recordings').select('id').not('notes_queued_at', 'is', null).neq('status', 'ready');
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

// ---------- Words ----------

export function planName(b: Billing): string {
  if (b.plan !== 'paid') return 'Free plan';
  return b.period === 'yearly' ? 'Pro plan, paid yearly' : 'Pro plan, paid monthly';
}

export function meterTitle(b: Billing): string {
  return `${b.minutesUsed} of ${b.minutesIncluded} minutes used`;
}

export function resetDate(b: Billing): string {
  if (!b.currentPeriodEnd) return '';
  const d = new Date(b.currentPeriodEnd);
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

export function meterDetail(b: Billing): string {
  const left = `${b.minutesLeft} minute${b.minutesLeft === 1 ? '' : 's'} left`;
  const when = resetDate(b);
  if (!when) return left;
  return b.plan === 'paid' ? `${left}. Your plan renews on ${when}.` : `${left}. Your free minutes reset on ${when}.`;
}

export function warningText(b: Billing): string {
  return `You have used ${b.minutesUsed} of ${b.minutesIncluded} minutes. Upgrade to keep getting notes for every recording.`;
}

export function limitText(b: Billing): string {
  return 'You are out of minutes. You can still record: your audio is saved. Notes start again when you upgrade or your minutes reset.';
}

export function waitingText(count: number): string {
  return count === 1 ? '1 recording is waiting for notes. Your audio is safe.' : `${count} recordings are waiting for notes. Your audio is safe.`;
}
