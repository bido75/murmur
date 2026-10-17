// Push notifications through Expo's push service (works for both iOS and Android builds).
import { adminClient } from './services.ts';

import { pushBatches, type PushMessage } from './push_batches.ts';
export type { PushMessage };

/** Send to every device a user registered; forget devices Expo says are gone. Never throws. */
export async function notifyUser(userId: string, m: PushMessage): Promise<void> {
  try {
    const admin = adminClient();
    const { data } = await admin.from('push_tokens').select('token').eq('user_id', userId);
    const tokens = (data ?? []).map((r: { token: string }) => r.token);
    // PUSH_GENERIC_TEXT=1 keeps recording titles and quotes off lock screens (e.g. for PHI).
    const msg = Deno.env.get('PUSH_GENERIC_TEXT') === '1' ? { ...m, title: Deno.env.get('APP_NAME') ?? 'Murmur', body: 'You have an update. Open the app to see it.' } : m;
    for (const batch of pushBatches(tokens, msg)) {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(Deno.env.get('EXPO_ACCESS_TOKEN') ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` } : {}) },
        body: JSON.stringify(batch),
      });
      const body = await res.json().catch(() => ({}));
      const tickets = (body?.data ?? []) as { status: string; details?: { error?: string } }[];
      const gone = batch.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered').map((b) => b.to);
      if (gone.length) await admin.from('push_tokens').delete().in('token', gone);
    }
  } catch (e) {
    console.warn('push failed', (e as Error).message);
  }
}
