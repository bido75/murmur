// The database side of billing: which plan a user is on, how many minutes they have used,
// which recordings are waiting for notes. The rules live in entitlements.ts; this file only
// reads and writes.
import { adminClient } from './services.ts';
import {
  applyEvent,
  billingState,
  freeEntitlement,
  isStale,
  rollover,
  type BillingState,
  type Entitlement,
  type Provider,
  type ProviderEvent,
} from './entitlements.ts';

/** What the user sees on a recording whose notes are waiting. */
export const DEFERRED_MESSAGE = 'Notes are waiting. Your audio is safe. Upgrade, or wait for your minutes to reset, then tap Retry.';

type Row = {
  plan: string;
  period: string;
  minutes_included: number;
  minutes_used: number;
  current_period_end: string;
  cancel_at: string | null;
  provider: string;
  provider_id: string | null;
  last_event_at: string | null;
};

function toEntitlement(row: Row): Entitlement {
  return {
    plan: row.plan === 'paid' ? 'paid' : 'free',
    period: row.period === 'yearly' ? 'yearly' : 'monthly',
    minutesIncluded: Number(row.minutes_included ?? 0),
    minutesUsed: Number(row.minutes_used ?? 0),
    currentPeriodEnd: row.current_period_end,
    cancelAt: row.cancel_at ?? null,
    provider: (['none', 'stripe', 'revenuecat'].includes(row.provider) ? row.provider : 'none') as Provider,
    providerId: row.provider_id ?? null,
    lastEventAt: row.last_event_at ?? null,
  };
}

/** Is the paywall switched on? The server decides, the app only asks. */
export async function billingFeatureOn(): Promise<boolean> {
  const admin = adminClient();
  const { data } = await admin.rpc('feature_enabled', { flag: 'billing' });
  return data === true;
}

/** Can the user buy a plan right now? */
export function canPay(): boolean {
  return Boolean(
    Deno.env.get('STRIPE_SECRET_KEY') ||
      Deno.env.get('REVENUECAT_WEB_PURCHASE_URL') ||
      Deno.env.get('REVENUECAT_API_KEY'),
  );
}

/** The plan on file. A user with nothing on file is on the free plan. */
export async function readEntitlement(userId: string, now: Date): Promise<Entitlement> {
  const admin = adminClient();
  const { data } = await admin.from('entitlements').select('*').eq('user_id', userId).maybeSingle();
  if (!data) {
    const fresh = freeEntitlement(now);
    await admin.from('entitlements').insert({
      user_id: userId,
      plan: fresh.plan,
      period: fresh.period,
      minutes_included: fresh.minutesIncluded,
      minutes_used: 0,
      current_period_end: fresh.currentPeriodEnd,
      provider: 'none',
    });
    return fresh;
  }
  return toEntitlement(data as Row);
}

export async function writeEntitlement(userId: string, state: Entitlement): Promise<void> {
  const admin = adminClient();
  await admin
    .from('entitlements')
    .update({
      plan: state.plan,
      period: state.period,
      minutes_included: state.minutesIncluded,
      minutes_used: state.minutesUsed,
      current_period_end: state.currentPeriodEnd,
      cancel_at: state.cancelAt,
      provider: state.provider,
      provider_id: state.providerId,
      last_event_at: state.lastEventAt,
    })
    .eq('user_id', userId);
}

/** Minutes used come from the recordings themselves, so nothing can be counted twice. */
export async function syncUsage(userId: string): Promise<number> {
  const admin = adminClient();
  const { data } = await admin.rpc('sync_entitlement_usage', { uid: userId });
  return Number(data ?? 0);
}

/** The plan, the minutes and what the app should tell the user. */
export async function currentBilling(userId: string, now: Date): Promise<BillingState> {
  const row = await readEntitlement(userId, now);
  // A period that has run out starts again on the free allowance.
  const rolled = rollover(row, now);
  if (rolled !== row) await writeEntitlement(userId, rolled);
  const used = await syncUsage(userId);
  return billingState({ ...rolled, minutesUsed: used }, now);
}

/**
 * A provider event, applied once. The same event twice does nothing the second time,
 * and an event for a period we have already moved past is ignored.
 */
export async function applyProviderEvent(event: ProviderEvent, now: Date): Promise<'applied' | 'duplicate' | 'stale'> {
  const admin = adminClient();
  const { error } = await admin.from('billing_events').insert({
    provider: event.provider,
    event_id: event.eventId,
    user_id: event.userId,
    event_type: event.type,
    occurred_at: event.occurredAt.toISOString(),
  });
  if (error) {
    if (error.code === '23505') return 'duplicate';
    throw error;
  }

  const row = await readEntitlement(event.userId, now);
  if (isStale({ lastEventAt: row.lastEventAt, currentPeriodEnd: row.currentPeriodEnd }, event)) {
    await admin.from('billing_events').update({ applied: false, note: 'stale' }).eq('provider', event.provider).eq('event_id', event.eventId);
    return 'stale';
  }

  await writeEntitlement(event.userId, applyEvent(row, event, now));
  await syncUsage(event.userId);
  await admin.from('billing_events').update({ applied: true }).eq('provider', event.provider).eq('event_id', event.eventId);
  return 'applied';
}

/** May this recording get its notes now? */
export async function notesAllowed(userId: string, now: Date): Promise<{ allowed: boolean; message: string }> {
  if (!(await billingFeatureOn())) return { allowed: true, message: '' };
  const state = await currentBilling(userId, now);
  if (!state.overLimit) return { allowed: true, message: '' };
  return { allowed: false, message: DEFERRED_MESSAGE };
}

/** Put a recording on hold. The audio stays exactly where it is. */
export async function deferNotes(recordingId: string, message: string): Promise<void> {
  const admin = adminClient();
  await admin
    .from('recordings')
    .update({ status: 'failed', error: message, notes_queued_at: new Date().toISOString() })
    .eq('id', recordingId);
}

/** Recordings whose notes are waiting. */
export async function queuedRecordings(userId: string): Promise<string[]> {
  const admin = adminClient();
  const { data } = await admin
    .from('recordings')
    .select('id')
    .eq('user_id', userId)
    .not('notes_queued_at', 'is', null)
    .neq('status', 'ready');
  return (data ?? []).map((r) => r.id as string);
}

/** Take a recording off hold so its notes can be made. */
export async function markResuming(recordingId: string): Promise<void> {
  const admin = adminClient();
  await admin.from('recordings').update({ status: 'transcribing', error: null, notes_queued_at: null }).eq('id', recordingId);
}
