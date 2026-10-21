import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPeriod,
  allowanceFor,
  applyEvent,
  billingState,
  freeEntitlement,
  isStale,
  revenueCatEvent,
  rollover,
  stripeEvent,
  stripeCheckoutBody,
  STRIPE_PLAN_EVENTS,
  FREE_MINUTES,
  PAID_MINUTES_MONTHLY,
  PAID_MINUTES_YEARLY,
  type Entitlement,
} from './entitlements.ts';

const now = new Date('2026-10-21T12:00:00.000Z');

const free = (over: Partial<Entitlement> = {}): Entitlement => ({ ...freeEntitlement(now), ...over });

const revenueCat = (over: Record<string, unknown> = {}) => ({
  event: {
    id: 'evt_1',
    type: 'INITIAL_PURCHASE',
    app_user_id: 'user-1',
    product_id: 'com.murmur.pro.monthly',
    event_timestamp_ms: now.getTime(),
    expiration_at_ms: new Date('2026-11-21T12:00:00.000Z').getTime(),
    ...over,
  },
});

const stripe = (over: Record<string, unknown> = {}, obj: Record<string, unknown> = {}) => ({
  id: 'evt_1',
  type: 'customer.subscription.created',
  created: Math.floor(now.getTime() / 1000),
  data: {
    object: {
      id: 'sub_1',
      status: 'active',
      metadata: { user_id: 'user-1' },
      current_period_end: Math.floor(new Date('2026-11-21T12:00:00.000Z').getTime() / 1000),
      items: { data: [{ price: { id: 'price_monthly', recurring: { interval: 'month' } } }] },
      ...obj,
    },
  },
  ...over,
});

test('the free plan is 60 minutes a month; paid plans are 300 a month and 3600 a year', () => {
  assert.equal(allowanceFor('free', 'monthly'), FREE_MINUTES);
  assert.equal(allowanceFor('paid', 'monthly'), PAID_MINUTES_MONTHLY);
  assert.equal(allowanceFor('paid', 'yearly'), PAID_MINUTES_YEARLY);
  assert.equal(freeEntitlement(now).minutesIncluded, 60);
  assert.equal(freeEntitlement(now).currentPeriodEnd, '2026-11-21T12:00:00.000Z');
});

test('the user is warned at 80% of their minutes and stopped at 100%', () => {
  // billingState is the one place these rules live.
  assert.equal(billingState(free({ minutesUsed: 47 }), now).warn, false);
  assert.equal(billingState(free({ minutesUsed: 48 }), now).warn, true);
  assert.equal(billingState(free({ minutesUsed: 60 }), now).warn, true);
  assert.equal(billingState(free({ minutesUsed: 59 }), now).overLimit, false);
  assert.equal(billingState(free({ minutesUsed: 60 }), now).overLimit, true);
  const state = billingState(free({ minutesUsed: 50 }), now);
  assert.equal(state.warn, true);
  assert.equal(state.overLimit, false);
  assert.equal(state.minutesLeft, 10);
});

test('a month ends on the same day of the next month, never past the end of a short one', () => {
  assert.equal(addPeriod(new Date('2026-01-31T09:00:00.000Z'), 'monthly').toISOString(), '2026-02-28T09:00:00.000Z');
  assert.equal(addPeriod(new Date('2026-03-31T09:00:00.000Z'), 'monthly').toISOString(), '2026-04-30T09:00:00.000Z');
  assert.equal(addPeriod(new Date('2026-02-21T09:00:00.000Z'), 'yearly').toISOString(), '2027-02-21T09:00:00.000Z');
});

test('when a period runs out the plan starts again on the free allowance', () => {
  const ended = free({ currentPeriodEnd: '2026-10-01T00:00:00.000Z', minutesUsed: 60 });
  const after = rollover(ended, now);
  assert.equal(after.plan, 'free');
  assert.equal(after.minutesIncluded, 60);
  assert.equal(after.minutesUsed, 0);
  assert.equal(after.currentPeriodEnd, '2026-11-21T12:00:00.000Z');
  // A period that is still running is left alone.
  const running = free({ currentPeriodEnd: '2026-12-01T00:00:00.000Z', minutesUsed: 12 });
  assert.equal(rollover(running, now), running);
  assert.equal(billingState(running, now).minutesUsed, 12);
  // The time of the last event survives the rollover, so a late event is still recognised.
  const endedWithEvent = free({ currentPeriodEnd: '2026-10-01T00:00:00.000Z', lastEventAt: '2026-10-01T00:00:00.000Z' });
  const afterEvent = rollover(endedWithEvent, now);
  assert.equal(afterEvent.lastEventAt, '2026-10-01T00:00:00.000Z');
  // An event from before the last one is stale, even after the period rolled over.
  const late = stripeEvent(stripe({ created: Math.floor(Date.parse('2026-09-01T00:00:00.000Z') / 1000) }), undefined);
  assert.ok(late);
  assert.equal(isStale({ lastEventAt: afterEvent.lastEventAt, currentPeriodEnd: afterEvent.currentPeriodEnd }, late), true);
});

test('a RevenueCat purchase gives the paid plan; a cancellation keeps it until the period ends', () => {
  const bought = revenueCatEvent(revenueCat());
  assert.ok(bought);
  assert.equal(bought.plan, 'paid');
  assert.equal(bought.period, 'monthly');
  assert.equal(bought.minutesIncluded, 300);
  assert.equal(bought.userId, 'user-1');
  assert.equal(bought.periodEnd?.toISOString(), '2026-11-21T12:00:00.000Z');
  assert.equal(bought.cancelAt, null);

  const yearly = revenueCatEvent(revenueCat({ product_id: 'com.murmur.pro.yearly' }));
  assert.equal(yearly?.period, 'yearly');
  assert.equal(yearly?.minutesIncluded, 3600);

  const cancelled = revenueCatEvent(revenueCat({ type: 'CANCELLATION' }));
  assert.equal(cancelled?.plan, 'paid');
  assert.equal(cancelled?.cancelAt?.toISOString(), '2026-11-21T12:00:00.000Z');

  const expired = revenueCatEvent(revenueCat({ type: 'EXPIRATION' }));
  assert.equal(expired?.plan, 'free');
  assert.equal(expired?.minutesIncluded, 60);
  assert.equal(expired?.periodEnd, null);

  // Events we do not sell, and events without a customer, are ignored.
  assert.equal(revenueCatEvent(revenueCat({ type: 'TRANSFER' })), null);
  assert.equal(revenueCatEvent(revenueCat({ app_user_id: '' })), null);
  assert.equal(revenueCatEvent({}), null);
});

test('a Stripe subscription gives the paid plan; a deleted one gives the free plan back', () => {
  const bought = stripeEvent(stripe());
  assert.ok(bought);
  assert.equal(bought.plan, 'paid');
  assert.equal(bought.period, 'monthly');
  assert.equal(bought.minutesIncluded, 300);
  assert.equal(bought.userId, 'user-1');
  assert.equal(bought.providerId, 'sub_1');

  const yearly = stripeEvent(stripe({}, {
    current_period_end: Math.floor(new Date('2027-10-21T12:00:00.000Z').getTime() / 1000),
    items: { data: [{ price: { id: 'price_yearly', recurring: { interval: 'year' } } }] },
  }));
  assert.equal(yearly?.period, 'yearly');
  assert.equal(yearly?.minutesIncluded, 3600);

  const cancelling = stripeEvent(stripe({}, { cancel_at_period_end: true }));
  assert.equal(cancelling?.plan, 'paid');
  assert.equal(cancelling?.cancelAt?.toISOString(), '2026-11-21T12:00:00.000Z');

  const deleted = stripeEvent(stripe({ type: 'customer.subscription.deleted' }));
  assert.equal(deleted?.plan, 'free');
  assert.equal(deleted?.minutesIncluded, 60);

  // An unpaid subscription, an event without a customer, and other event types are ignored.
  assert.equal(stripeEvent(stripe({}, { status: 'unpaid' }))?.plan, 'free');
  assert.equal(stripeEvent(stripe({}, { metadata: {} })), null);
  assert.equal(stripeEvent(stripe({ type: 'invoice.paid' })), null);
});

test('a late or repeated event is ignored, so minutes are never counted twice', () => {
  const bought = revenueCatEvent(revenueCat())!;
  const current = { lastEventAt: '2026-10-21T12:00:00.000Z', currentPeriodEnd: '2026-11-21T12:00:00.000Z' };
  assert.equal(isStale(current, bought), false);

  const late = revenueCatEvent(revenueCat({ id: 'evt_2', event_timestamp_ms: new Date('2026-10-01T00:00:00.000Z').getTime() }))!;
  assert.equal(isStale(current, late), true);

  const older = revenueCatEvent(revenueCat({ id: 'evt_3', expiration_at_ms: new Date('2026-09-21T00:00:00.000Z').getTime() }))!;
  assert.equal(isStale(current, older), true);

  // The first event we ever get is never stale.
  assert.equal(isStale({ lastEventAt: null }, late), false);
});

test('a provider event sets the plan and starts a fresh period', () => {
  const event = stripeEvent(stripe())!;
  const next = applyEvent(free({ minutesUsed: 42 }), event, now);
  assert.equal(next.plan, 'paid');
  assert.equal(next.period, 'monthly');
  assert.equal(next.minutesIncluded, 300);
  assert.equal(next.minutesUsed, 0);
  assert.equal(next.currentPeriodEnd, '2026-11-21T12:00:00.000Z');
  assert.equal(next.provider, 'stripe');
  assert.equal(next.providerId, 'sub_1');
  assert.equal(next.lastEventAt, '2026-10-21T12:00:00.000Z');
});

test('the checkout puts the user id on the subscription, not only on the session', () => {
  const body = stripeCheckoutBody({ userId: 'user-1', price: 'price_monthly', appUrl: 'https://app.example.com/' });
  assert.equal(body.mode, 'subscription');
  assert.equal(body['line_items[0][price]'], 'price_monthly');
  assert.equal(body['line_items[0][quantity]'], '1');
  assert.equal(body.success_url, 'https://app.example.com/?checkout=success');
  assert.equal(body.cancel_url, 'https://app.example.com/?checkout=cancelled');
  assert.equal(body.client_reference_id, 'user-1');
  assert.equal(body['metadata[user_id]'], 'user-1');
  // Stripe keeps session metadata with the session and does not copy it to the
  // subscription, so the user id has to travel on the subscription as well.
  assert.equal(body['subscription_data[metadata][user_id]'], 'user-1');
});

test('the subscription Stripe creates from that checkout is one the webhook can read', () => {
  const body = stripeCheckoutBody({ userId: 'user-1', price: 'price_monthly', appUrl: 'https://app.example.com' });
  const created = stripe({}, { metadata: { user_id: body['subscription_data[metadata][user_id]'] } });
  const event = stripeEvent(created);
  assert.ok(event);
  assert.equal(event.userId, 'user-1');
  assert.equal(event.plan, 'paid');
  assert.equal(event.providerId, 'sub_1');
  // Without that metadata the event names no user and nothing is written.
  assert.equal(stripeEvent(stripe({}, { metadata: {} })), null);
});

test('the events we act on are the subscription events', () => {
  assert.deepEqual(STRIPE_PLAN_EVENTS, ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);
  for (const type of STRIPE_PLAN_EVENTS) assert.ok(stripeEvent(stripe({ type })), `${type} is handled`);
  assert.equal(stripeEvent(stripe({ type: 'checkout.session.completed' })), null);
});
