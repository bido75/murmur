// Stripe's signature rules for the webhooks we receive.
//
// The header looks like `t=1712345678,v1=<hex>,v1=<hex>`. Stripe sends one v1 per
// endpoint secret it knows about (after a secret rotation both are sent for a
// while), so every v1 has to be checked - not just the last one, which is what
// reading the header into a single-value map would do.
//
// This is separate from `verifyWebhookSignature` in connect.ts on purpose: that
// one checks the signatures Murmur itself sends to third parties (always exactly
// one v1), and connect.ts belongs to another agent's work. See stripe.test.ts.

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return hex(mac);
}

/** The timestamp and every signature in a `stripe-signature` header. */
export function stripeSignatureParts(header: string): { t: number; v1: string[] } {
  let t = Number.NaN;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name === 't') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) t = parsed;
    } else if (name === 'v1' && value) {
      v1.push(value);
    }
  }
  return { t, v1 };
}

/** True when one of the header's signatures is ours and the timestamp is fresh. */
export async function stripeSignatureValid(secret: string, body: string, header: string, now = Date.now(), toleranceSeconds = 300): Promise<boolean> {
  const { t, v1 } = stripeSignatureParts(header);
  if (!Number.isFinite(t) || v1.length === 0) return false;
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = await sign(secret, `${t}.${body}`);
  for (const candidate of v1) {
    if (candidate.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
}
