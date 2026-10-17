// Sending notes to other tools (Deno). Built on the pure builders in connect.ts and
// oauth_providers.ts. Used by the `export` function (on demand) and by automations.
import { adminClient } from './services.ts';
import { renewOnce } from './token_lock.ts';
import { crmNoteText, notionBlocks, oneNoteHtml, slackMessage } from './connect.ts';
import { driveMultipart, providerConf, refreshBody, soqlString, type OAuthProvider } from './oauth_providers.ts';
import { hubspot } from './trackers.ts';
import type { PublicNotes } from './share.ts';

type Row = { secret: string; access_secret: string | null; access_expires_at: string | null; config: Record<string, unknown> };

export async function loadIntegration(userId: string, provider: string): Promise<Row | null> {
  const { data } = await adminClient().from('integrations').select('secret, access_secret, access_expires_at, config').eq('user_id', userId).eq('provider', provider).maybeSingle();
  return (data as Row | null) ?? null;
}

/** A fresh access token for an OAuth destination, saving rotated refresh tokens. */
export async function accessFor(userId: string, provider: Exclude<OAuthProvider, 'slack'>, row: Row): Promise<string> {
  const fresh = (r: { access_secret: string | null; access_expires_at: string | null }) => Boolean(r.access_secret && r.access_expires_at && new Date(r.access_expires_at).getTime() - Date.now() > 60_000);
  if (fresh(row)) return row.access_secret!;
  return await renewOnce(userId, provider, fresh, async () => {
    const latest = await loadIntegration(userId, provider); // newest refresh token
    return await renewOAuth(userId, provider, latest ?? row);
  });
}

async function renewOAuth(userId: string, provider: Exclude<OAuthProvider, 'slack'>, row: Row): Promise<string> {
  const conf = providerConf(provider, (k) => Deno.env.get(k));
  const id = Deno.env.get(conf.idEnv) ?? '';
  const secret = Deno.env.get(conf.secretEnv) ?? '';
  const res = await fetch(conf.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: refreshBody(id, secret, row.secret, provider === 'onenote' ? conf.scope : undefined),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`The ${provider.replace('_', ' ')} connection expired. Reconnect it in Settings.`);
  const patch: Record<string, unknown> = {
    access_secret: body.access_token,
    access_expires_at: new Date(Date.now() + (Number(body.expires_in) || 3600) * 1000).toISOString(),
  };
  if (body.refresh_token && body.refresh_token !== row.secret) patch.secret = body.refresh_token;
  await adminClient().from('integrations').update(patch).eq('user_id', userId).eq('provider', provider);
  return body.access_token;
}

async function ok(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res;
}

export async function postSlack(userId: string, n: PublicNotes, link: string | null) {
  const row = await loadIntegration(userId, 'slack');
  if (!row) throw new Error('Connect Slack first.');
  await ok(await fetch(row.secret, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(slackMessage(n, link)) }), 'Slack');
  return { url: null, channel: (row.config.target as { name?: string } | undefined)?.name ?? null };
}

export async function exportNotion(userId: string, n: PublicNotes, link: string | null) {
  const row = await loadIntegration(userId, 'notion');
  if (!row) throw new Error('Connect Notion first.');
  const parent = (row.config.target as { id?: string } | undefined)?.id;
  if (!parent) throw new Error('Choose a Notion page for notes in Settings → Connections.');
  const res = await ok(
    await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${row.secret}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent: { page_id: parent },
        properties: { title: { title: [{ type: 'text', text: { content: `${n.title} (${n.date.slice(0, 10)})`.slice(0, 200) } }] } },
        children: notionBlocks(n, link),
      }),
    }),
    'Notion',
  );
  const page = await res.json();
  return { url: page.url as string };
}

export async function notionPages(token: string) {
  const res = await ok(
    await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: { property: 'object', value: 'page' }, page_size: 50 }),
    }),
    'Notion',
  );
  const body = await res.json();
  return ((body.results ?? []) as { id: string; properties?: Record<string, { type: string; title?: { plain_text: string }[] }> }[]).map((p) => {
    const titleProp = Object.values(p.properties ?? {}).find((x) => x.type === 'title');
    return { id: p.id, name: titleProp?.title?.map((t) => t.plain_text).join('') || 'Untitled' };
  });
}

export async function exportGoogleDoc(userId: string, title: string, docx: Uint8Array) {
  const row = await loadIntegration(userId, 'google_docs');
  if (!row) throw new Error('Connect Google Docs first.');
  const access = await accessFor(userId, 'google_docs', row);
  const { body, contentType } = driveMultipart(title, docx);
  const res = await ok(
    await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': contentType },
      body: body as BodyInit,
    }),
    'Google Docs',
  );
  const f = await res.json();
  return { url: (f.webViewLink as string) ?? `https://docs.google.com/document/d/${f.id}/edit` };
}

export async function exportOneNote(userId: string, n: PublicNotes, link: string | null) {
  const row = await loadIntegration(userId, 'onenote');
  if (!row) throw new Error('Connect OneNote first.');
  const access = await accessFor(userId, 'onenote', row);
  const res = await ok(
    await fetch('https://graph.microsoft.com/v1.0/me/onenote/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'text/html' },
      body: oneNoteHtml(n, link),
    }),
    'OneNote',
  );
  const page = await res.json();
  return { url: (page.links?.oneNoteWebUrl?.href as string) ?? null };
}

/** Log the meeting on HubSpot contacts (found by email) as a note. */
export async function logHubspot(userId: string, n: PublicNotes, link: string | null, emails: string[]) {
  const row = await loadIntegration(userId, 'hubspot');
  if (!row) throw new Error('Connect HubSpot first.');
  const note = await hubspot<{ id: string }>(row.secret, '/crm/v3/objects/notes', {
    method: 'POST',
    body: JSON.stringify({ properties: { hs_timestamp: new Date(n.date).toISOString(), hs_note_body: crmNoteText(n, link).replace(/\n/g, '<br>') } }),
  });
  let linked = 0;
  for (const email of emails.slice(0, 10)) {
    const found = await hubspot<{ results: { id: string }[] }>(row.secret, '/crm/v3/objects/contacts/search', {
      method: 'POST',
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }], limit: 1 }),
    });
    const contact = found.results?.[0]?.id;
    if (contact) {
      await hubspot(row.secret, `/crm/v4/objects/notes/${note.id}/associations/default/contacts/${contact}`, { method: 'PUT' });
      linked++;
    }
  }
  return { url: null, id: note.id, linked };
}

/** Log the meeting in Salesforce as a completed Task, linked to the first contact or lead found by email. */
export async function logSalesforce(userId: string, n: PublicNotes, link: string | null, emails: string[]) {
  const row = await loadIntegration(userId, 'salesforce');
  if (!row) throw new Error('Connect Salesforce first.');
  const access = await accessFor(userId, 'salesforce', row);
  const base = `${String(row.config.instance_url)}/services/data/v60.0`;
  const sf = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  let whoId: string | null = null;
  for (const email of emails.slice(0, 5)) {
    for (const obj of ['Contact', 'Lead']) {
      const q = `SELECT Id FROM ${obj} WHERE Email = ${soqlString(email)} LIMIT 1`;
      const res = await sf(`/query?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const id = (await res.json()).records?.[0]?.Id;
        if (id) {
          whoId = id;
          break;
        }
      }
    }
    if (whoId) break;
  }
  const res = await ok(
    await sf('/sobjects/Task', {
      method: 'POST',
      body: JSON.stringify({
        Subject: `Meeting: ${n.title}`.slice(0, 255),
        Description: crmNoteText(n, link).slice(0, 32000),
        Status: 'Completed',
        ActivityDate: n.date.slice(0, 10),
        ...(whoId ? { WhoId: whoId } : {}),
      }),
    }),
    'Salesforce',
  );
  const t = await res.json();
  return { url: `${String(row.config.instance_url)}/${t.id}`, id: t.id as string, linked: whoId ? 1 : 0 };
}

/** Create a Salesforce task for an action item (tracker use). */
export async function salesforceTask(userId: string, title: string, description: string, dueDate: string | null) {
  const row = await loadIntegration(userId, 'salesforce');
  if (!row) throw new Error('Connect Salesforce first.');
  const access = await accessFor(userId, 'salesforce', row);
  const res = await ok(
    await fetch(`${String(row.config.instance_url)}/services/data/v60.0/sobjects/Task`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ Subject: title.slice(0, 255), Description: description.slice(0, 32000), Status: 'Not Started', ...(dueDate ? { ActivityDate: dueDate } : {}) }),
    }),
    'Salesforce',
  );
  const t = await res.json();
  return { id: t.id as string, key: undefined as string | undefined, url: `${String(row.config.instance_url)}/${t.id}` };
}
