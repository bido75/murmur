// The user's plan: how many minutes are left, where to buy a plan, and how to cancel it.
// The server decides everything; the app only asks and shows.
//   GET  /billing            -> the plan, the minutes used, and what is waiting
//   POST /billing/checkout   -> { period } -> { url }
//   POST /billing/cancel     -> { } -> { ok, ends_on }
import { corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { stripeCheckoutBody } from '../_shared/entitlements.ts';
import { billingFeatureOn, canPay, currentBilling, queuedRecordings } from '../_shared/billing_store.ts';
import { resumeQueued } from '../_shared/billing_resume.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const path = new URL(req.url).pathname;
  try {
    const { id: userId } = await requireUser(req);
    if (path.endsWith('/checkout') && req.method === 'POST') return await checkout(req, userId);
    if (path.endsWith('/cancel') && req.method === 'POST') return await cancel(userId);
    if (req.method === 'GET') return await status(userId);
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    const code = e instanceof HttpError ? e.status : 500;
    if (code === 500) console.error('billing error', e);
    return json({ error: (e as Error).message }, code);
  }
});

async function status(userId: string) {
  const now = new Date();
  const paywall = await billingFeatureOn();
  const state = await currentBilling(userId, now);
  const waiting = await queuedRecordings(userId).then((ids) => ids.length);
  // If there is room now, the recordings that were waiting get their notes.
  if (waiting && !state.overLimit) await resumeQueued(userId).catch((e) => console.error('resume failed', e));
  return json({
    paywall,
    plan: state.plan,
    period: state.period,
    minutes_included: state.minutesIncluded,
    minutes_used: state.minutesUsed,
    minutes_left: state.minutesLeft,
    warn: state.warn,
    over_limit: state.overLimit,
    current_period_end: state.currentPeriodEnd,
    cancel_at: state.cancelAt,
    provider: state.provider,
    can_buy: canPay(),
    waiting,
  });
}

async function checkout(req: Request, userId: string) {
  const body = (await req.json().catch(() => ({}))) as { period?: string };
  const period = body.period === 'yearly' ? 'yearly' : 'monthly';
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  const price = period === 'yearly' ? Deno.env.get('STRIPE_PRICE_YEARLY') : Deno.env.get('STRIPE_PRICE_MONTHLY');

  if (key && price) {
    const appUrl = Deno.env.get('APP_URL') ?? '';
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(stripeCheckoutBody({ userId, price, appUrl })),
    });
    const session = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
    if (!res.ok || !session.url) throw new HttpError(502, session.error?.message ?? 'Could not start the checkout.');
    return json({ url: session.url });
  }

  const webUrl = Deno.env.get('REVENUECAT_WEB_PURCHASE_URL');
  if (webUrl) {
    const join = webUrl.includes('?') ? '&' : '?';
    return json({ url: `${webUrl}${join}app_user_id=${encodeURIComponent(userId)}` });
  }

  throw new HttpError(503, 'Buying a plan is not set up on the server yet.');
}

async function cancel(userId: string) {
  const state = await currentBilling(userId, new Date());
  if (state.plan !== 'paid') return json({ ok: true, already_cancelled: true });

  if (state.provider === 'stripe' && state.providerId) {
    const key = Deno.env.get('STRIPE_SECRET_KEY');
    if (!key) throw new HttpError(503, 'Cancelling a plan is not set up on the server yet.');
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${state.providerId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ cancel_at_period_end: 'true' }),
    });
    if (!res.ok) throw new HttpError(502, 'Could not cancel the plan.');
    return json({ ok: true, ends_on: state.currentPeriodEnd });
  }

  if (state.provider === 'revenuecat') {
    const key = Deno.env.get('REVENUECAT_API_KEY');
    if (key) {
      const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(state.providerId ?? userId)}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new HttpError(502, 'Could not cancel the plan.');
      return json({ ok: true, ends_on: state.currentPeriodEnd });
    }
  }

  throw new HttpError(503, 'Cancelling a plan is not set up on the server yet.');
}
