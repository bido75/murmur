// One token renewal at a time per connection. Providers like Procore and Microsoft hand out a new
// refresh token on every renewal and cancel the old one, so two renewals racing would leave one
// with a dead token and force the user to reconnect. The loser waits for the winner's new token.
import { adminClient } from './services.ts';

type Fresh = { access_secret: string | null; access_expires_at: string | null };

export async function renewOnce(
  userId: string,
  provider: string,
  stillFresh: (row: Fresh) => boolean,
  renew: () => Promise<string>,
): Promise<string> {
  const db = adminClient();
  const { data: claimed } = await db.rpc('claim_token_refresh', { uid: userId, prov: provider });
  if (claimed) {
    try {
      return await renew();
    } finally {
      await db.from('integrations').update({ refreshing_until: null }).eq('user_id', userId).eq('provider', provider);
    }
  }
  // Someone else is renewing: wait for their token (up to ~15 s).
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const { data } = await db.from('integrations').select('access_secret, access_expires_at, refreshing_until').eq('user_id', userId).eq('provider', provider).maybeSingle();
    if (data && data.access_secret && stillFresh(data as Fresh)) return data.access_secret as string;
    if (!data?.refreshing_until) break; // they finished (or failed): try ourselves
  }
  return await renew();
}
