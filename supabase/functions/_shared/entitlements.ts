// Pure billing rules: what a plan includes, how many minutes are left, what a provider's
// webhook means, and whether an event is out of date. No network, no database, and the
// clock is always passed in, so every rule here can be tested. See entitlements.test.ts.

export type Plan = 'free' | 'paid';
export type Period = 'monthly' | 'yearly';
export type Provider = 'none' | 'stripe' | 'revenuecat';

export const FREE_MINUTES = 60;
export const PAID_MINUTES_MONTHLY = 300;
export const PAID_MINUTES_YEARLY = 3600;
/** Warn the user once they have used this much of their minutes. */
export const WARNING_RATIO = 0.8;

export type Entitlement = {
  plan: Plan;
  period: Period;
  minutesIncluded: number;
  minutesUsed: number;
  currentPeriodEnd: string;
  cancelAt: string | null;
  provider: Provider;
  providerId: string | null;
  lastEventAt: string | null;
};

export type BillingState = {
  plan: Plan;
  period: Period;
  minutesIncluded: number;
  minutesUsed: number;
  minutesLeft: number;
  ratio: number;
  /** Past the warning point: tell the user before they run out. */
  warn: boolean;
  /** No minutes left in this period. */
  overLimit: boolean;
  currentPeriodEnd: string;
  cancelAt: string | null;
  provider: Provider;
  providerId: string | null;
  /** A paid plan that is running now. */
  active: boolean;
};

export function allowanceFor(plan: Plan, period: Period): number {
  if (plan === 'free') return FREE_MINUTES;
  return period === 'yearly' ? PAID_MINUTES_YEARLY : PAID_MINUTES_MONTHLY;
}

/** Add a month or a year without sliding past the end of a short month. */
export function addPeriod(from: Date, period: Period): Date {
  const day = from.getUTCDate();
  const months = period === 'yearly' ? 12 : 1;
  const out = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/** The plan a user has when there is nothing on file: 60 free minutes a month. */
export function freeEntitlement(now: Date): Entitlement {
  return {
    plan: 'free',
    period: 'monthly',
    minutesIncluded: FREE_MINUTES,
    minutesUsed: 0,
    currentPeriodEnd: addPeriod(now, 'monthly').toISOString(),
    cancelAt: null,
    provider: 'none',
    providerId: null,
    lastEventAt: null,
  };
}

/**
 * A period that has run out starts again: the free allowance, no minutes used, and the
 * provider is remembered so the app can still say which plan ended.
 *
 * The time of the last event is kept: it is what tells a late provider event from a
 * current one, and it has to survive the rollover or an old event could be taken as new.
 */
export function rollover(state: Entitlement, now: Date): Entitlement {
  const end = Date.parse(state.currentPeriodEnd);
  if (!Number.isFinite(end) || end > now.getTime()) return state;
  return { ...freeEntitlement(now), provider: state.provider, providerId: state.providerId, lastEventAt: state.lastEventAt };
}

export function billingState(state: Entitlement, now: Date): BillingState {
  const s = rollover(state, now);
  const minutesLeft = Math.max(0, s.minutesIncluded - s.minutesUsed);
  const ratio = s.minutesIncluded > 0 ? s.minutesUsed / s.minutesIncluded : 1;
  return {
    plan: s.plan,
    period: s.period,
    minutesIncluded: s.minutesIncluded,
    minutesUsed: s.minutesUsed,
    minutesLeft,
    ratio,
    warn: s.minutesUsed > 0 && ratio >= WARNING_RATIO,
    overLimit: s.minutesUsed >= s.minutesIncluded,
    currentPeriodEnd: s.currentPeriodEnd,
    cancelAt: s.cancelAt,
    provider: s.provider,
    providerId: s.providerId,
    active: s.plan === 'paid',
  };
}

export type ProviderEvent = {
  provider: Provider;
  eventId: string;
  type: string;
  userId: string;
  occurredAt: Date;
  plan: Plan;
  period: Period;
  minutesIncluded: number;
  periodEnd: Date | null;
  cancelAt: Date | null;
  providerId: string | null;
};

// RevenueCat events that mean the customer keeps (or gets) a paid plan.
const RC_ENTITLEMENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_PRODUCT_CHANGE',
  'BILLING_ISSUE',
  'CANCELLATION',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A RevenueCat webhook body, read as the plan change it describes. */
export function revenueCatEvent(payload: unknown): ProviderEvent | null {
  const root = asRecord(payload);
  const ev = asRecord(root?.event);
  if (!ev) return null;
  const type = str(ev.type);
  const eventId = str(ev.id);
  const userId = str(ev.app_user_id);
  if (!eventId || !userId) return null;

  const stamp = num(ev.event_timestamp_ms);
  const occurredAt = stamp ? new Date(stamp) : new Date(0);
  const productId = str(ev.product_id);
  const period: Period = /year|annual/i.test(productId) ? 'yearly' : 'monthly';
  const expires = num(ev.expiration_at_ms);
  const periodEnd = expires ? new Date(expires) : null;

  const base = { provider: 'revenuecat' as Provider, eventId, type, userId, occurredAt, period, providerId: userId };

  if (type === 'EXPIRATION') {
    return { ...base, plan: 'free', minutesIncluded: FREE_MINUTES, periodEnd: null, cancelAt: null };
  }
  if (!RC_ENTITLEMENTS.has(type)) return null;

  // A cancellation or a billing problem keeps the plan until the paid period runs out.
  const cancelAt = type === 'CANCELLATION' || type === 'BILLING_ISSUE' ? periodEnd : null;
  return { ...base, plan: 'paid', minutesIncluded: allowanceFor('paid', period), periodEnd, cancelAt };
}

/**
 * The Stripe event types that describe a plan change. These are the events an
 * operator has to send to the webhook; anything else is ignored on purpose.
 */
export const STRIPE_PLAN_EVENTS: string[] = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];

/**
 * The Stripe Checkout Session body.
 *
 * The user id has to travel on the subscription itself, not only on the session:
 * Stripe keeps Checkout Session metadata with the session and does not copy it to
 * the subscription it creates, so without `subscription_data[metadata][user_id]`
 * the subscription webhook arrives with no user id and nobody's plan is ever
 * written. See stripe.test.ts and entitlements.test.ts.
 */
export function stripeCheckoutBody(args: { userId: string; price: string; appUrl: string }): Record<string, string> {
  const appUrl = args.appUrl.replace(/\/$/, '');
  return {
    mode: 'subscription',
    'line_items[0][price]': args.price,
    'line_items[0][quantity]': '1',
    success_url: `${appUrl}/?checkout=success`,
    cancel_url: `${appUrl}/?checkout=cancelled`,
    client_reference_id: args.userId,
    'metadata[user_id]': args.userId,
    'subscription_data[metadata][user_id]': args.userId,
  };
}

/** A Stripe webhook body, read as the plan change it describes. */
export function stripeEvent(payload: unknown, allowance?: (period: Period, priceId: string) => number): ProviderEvent | null {
  const root = asRecord(payload);
  if (!root) return null;
  const type = str(root.type);
  const eventId = str(root.id);
  if (!eventId) return null;

  const obj = asRecord(asRecord(root.data)?.object) ?? {};
  const userId = str(asRecord(obj.metadata)?.user_id);
  const created = num(root.created);
  const occurredAt = created ? new Date(created * 1000) : new Date(0);

  const items = asRecord(obj.items);
  const list = Array.isArray(items?.data) ? items.data : [];
  const item = asRecord(list[0]);
  const price = asRecord(item?.price);
  const interval = str(asRecord(price?.recurring)?.interval);
  const period: Period = interval === 'year' ? 'yearly' : 'monthly';
  const priceId = str(price?.id);

  const endRaw = num(obj.current_period_end) || num(item?.current_period_end);
  const periodEnd = endRaw ? new Date(endRaw * 1000) : null;

  const base = { provider: 'stripe' as Provider, eventId, type, userId, occurredAt, period, providerId: str(obj.id) };

  if (type === 'customer.subscription.deleted') {
    if (!userId) return null;
    return { ...base, plan: 'free', minutesIncluded: FREE_MINUTES, periodEnd: null, cancelAt: null };
  }
  if (!STRIPE_PLAN_EVENTS.includes(type)) return null;
  if (!userId) return null;

  // Unpaid or paused subscriptions get the free plan back.
  const status = str(obj.status);
  const running = status === 'active' || status === 'trialing' || status === 'past_due';
  if (!running) {
    return { ...base, plan: 'free', minutesIncluded: FREE_MINUTES, periodEnd: null, cancelAt: null };
  }

  const cancelAt = obj.cancel_at_period_end ? periodEnd : num(obj.canceled_at) ? new Date(num(obj.canceled_at) * 1000) : null;
  const minutesIncluded = allowance ? allowance(period, priceId) : allowanceFor('paid', period);
  return { ...base, plan: 'paid', minutesIncluded, periodEnd, cancelAt };
}

/**
 * An event we have already applied, or one for a period that has been replaced by a newer
 * one, is ignored. Providers send events late and more than once.
 */
export function isStale(current: { lastEventAt: string | null; currentPeriodEnd?: string | null }, incoming: ProviderEvent): boolean {
  const last = current.lastEventAt ? Date.parse(current.lastEventAt) : NaN;
  if (Number.isFinite(last) && incoming.occurredAt.getTime() < last) return true;
  const currentEnd = current.currentPeriodEnd ? Date.parse(current.currentPeriodEnd) : NaN;
  if (incoming.plan === 'paid' && incoming.periodEnd && Number.isFinite(currentEnd) && incoming.periodEnd.getTime() < currentEnd) return true;
  return false;
}

/** The plan after a provider event. Usage is worked out again from the recordings. */
export function applyEvent(state: Entitlement, event: ProviderEvent, now: Date): Entitlement {
  const paid = event.plan === 'paid';
  const end = event.periodEnd ?? (paid ? addPeriod(now, event.period) : addPeriod(now, 'monthly'));
  return {
    plan: event.plan,
    period: paid ? event.period : 'monthly',
    minutesIncluded: event.minutesIncluded,
    minutesUsed: 0,
    currentPeriodEnd: end.toISOString(),
    cancelAt: event.cancelAt ? event.cancelAt.toISOString() : null,
    provider: event.provider,
    providerId: event.providerId,
    lastEventAt: event.occurredAt.toISOString(),
  };
}
