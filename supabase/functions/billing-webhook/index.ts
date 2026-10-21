// Plan changes from the payment providers. Deploy with --no-verify-jwt (the providers
// send their own signature, not a session).
//   POST /billing-webhook  -> Stripe (stripe-signature header) or RevenueCat (bearer token)
// The same event can arrive twice: the second time does nothing.
import { corsHeaders, HttpError, json } from '../_shared/services.ts';
import { stripeSignatureValid } from '../_shared/stripe.ts';
import { revenueCatEvent, stripeEvent, STRIPE_PLAN_EVENTS, type ProviderEvent } from '../_shared/entitlements.ts';
import { applyProviderEvent, currentBilling } from '../_shared/billing_store.ts';
import { resumeQueued } from '../_shared/billing_resume.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
    const body = await req.text();
    const payload = parse(body);
    const type = eventType(payload);
    const signature = req.headers.get('stripe-signature');
    const event = signature ? await stripe(body, payload, signature) : await revenueCat(payload, req.headers.get('authorization') ?? '');
    if (!event) {
      // Say what was ignored: a misconfigured webhook should be visible, not silent.
      console.warn('billing webhook ignored an event', { type });
      return json({ ok: true, ignored: 'not a plan change', type });
    }

    const now = new Date();
    const result = await applyProviderEvent(event, now);
    // A new plan means the recordings that were waiting can get their notes.
    if (result === 'applied') {
      const state = await currentBilling(event.userId, now);
      if (!state.overLimit) await resumeQueued(event.userId).catch((e) => console.error('resume failed', e));
    }
    return json({ ok: true, result });
  } catch (e) {
    const code = e instanceof HttpError ? e.status : 500;
    if (code === 500) console.error('billing webhook error', e);
    return json({ error: (e as Error).message }, code);
  }
});

/** A Stripe event, if the signature checks out. The raw body is what Stripe signed. */
async function stripe(body: string, payload: unknown, signature: string): Promise<ProviderEvent | null> {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) throw new HttpError(503, 'Stripe is not set up on this server.');
  if (!(await stripeSignatureValid(secret, body, signature))) throw new HttpError(400, 'That Stripe signature did not check out.');
  const event = stripeEvent(payload);
  if (!event && STRIPE_PLAN_EVENTS.includes(eventType(payload))) {
    // A plan change without a user id means the checkout did not put one on the
    // subscription, so nobody would know who paid.
    console.warn('stripe plan change without a user id', { type: eventType(payload) });
  }
  return event;
}

/** A RevenueCat event, if the bearer token checks out. */
async function revenueCat(payload: unknown, authorization: string): Promise<ProviderEvent | null> {
  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  if (!secret) throw new HttpError(503, 'RevenueCat is not set up on this server.');
  if (!(await sameSecret(authorization, `Bearer ${secret}`))) throw new HttpError(401, 'Not allowed.');
  return revenueCatEvent(payload);
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'That was not a JSON body.');
  }
}

/** Both providers name the event in a top-level `type`. */
function eventType(payload: unknown): string {
  const root = payload as { type?: unknown } | null;
  return typeof root?.type === 'string' ? root.type : 'unknown';
}

/** Compare two secrets without telling the caller which part was wrong. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
