// Task tracker adapters (personal-token auth). Each one can: check a token, list where
// tasks can go, and create a task. Request building is kept pure where possible.

export type Provider = 'asana' | 'linear' | 'jira' | 'procore' | 'monday' | 'clickup' | 'trello' | 'hubspot' | 'salesforce';
export type Target = { id: string; name: string };
export type Created = { id: string; key?: string; url: string };
export type IssueInput = {
  title: string;
  description: string; // plain text, may contain newlines
  dueDate?: string | null; // YYYY-MM-DD
};
/** Non-secret settings saved alongside the token. */
export type Config = { account?: string; target?: Target; site?: string; email?: string; workspace?: string; key?: string; instance_url?: string };

export const PROVIDERS: Provider[] = ['asana', 'linear', 'jira', 'procore', 'monday', 'clickup', 'trello', 'hubspot', 'salesforce'];
/** Connected by pasting a token. Procore and Salesforce connect by signing in (OAuth). */
export const TOKEN_PROVIDERS: Provider[] = ['asana', 'linear', 'jira', 'monday', 'clickup', 'trello', 'hubspot'];

async function check(res: Response, what: string) {
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new Error(`${what}: the token was rejected (${res.status}).`);
    throw new Error(`${what} failed (${res.status}): ${body}`);
  }
  return res;
}

// ---------- Linear (GraphQL; personal API keys go in Authorization without "Bearer") ----------

async function linear<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await check(
    await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    }),
    'Linear',
  );
  const body = await res.json();
  if (body.errors?.length) throw new Error(`Linear: ${body.errors[0].message}`);
  return body.data as T;
}

// ---------- Asana (REST, Bearer PAT) ----------

async function asana<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await check(
    await fetch(`https://app.asana.com/api/1.0${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
    }),
    'Asana',
  );
  return (await res.json()).data as T;
}

// ---------- Jira Cloud (REST v3, Basic email:token) ----------

export function jiraSite(site: string): string {
  const s = site.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!s) throw new Error('Jira site is required, e.g. yourcompany.atlassian.net');
  return s.includes('.') ? s : `${s}.atlassian.net`;
}

async function jira<T>(token: string, config: Config, path: string, init: RequestInit = {}): Promise<T> {
  if (!config.email) throw new Error('Jira needs the email address of the account that made the token.');
  const auth = btoa(`${config.email}:${token}`);
  const res = await check(
    await fetch(`https://${jiraSite(config.site ?? '')}/rest/api/3${path}`, {
      ...init,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
    }),
    'Jira',
  );
  return (await res.json()) as T;
}

/** Jira descriptions use Atlassian Document Format: one paragraph per line. */
export function toAdf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: text
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
  };
}

// ---------- Monday.com (GraphQL; personal API token in Authorization) ----------

async function monday<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await check(
    await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json', 'API-Version': '2024-10' },
      body: JSON.stringify({ query, variables }),
    }),
    'Monday',
  );
  const body = await res.json();
  if (body.errors?.length) throw new Error(`Monday: ${body.errors[0].message}`);
  return body.data as T;
}

// ---------- ClickUp (REST; personal token in Authorization) ----------

async function clickup<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await check(
    await fetch(`https://api.clickup.com/api/v2${path}`, { ...init, headers: { Authorization: token, 'Content-Type': 'application/json', ...(init.headers ?? {}) } }),
    'ClickUp',
  );
  return (await res.json()) as T;
}

// ---------- Trello (REST; API key + token as query parameters) ----------

export function trelloUrl(path: string, key: string, token: string, params: Record<string, string> = {}): string {
  const u = new URL(`https://api.trello.com/1${path}`);
  u.search = new URLSearchParams({ ...params, key, token }).toString();
  return u.toString();
}

async function trello<T>(token: string, config: Config, path: string, init: RequestInit = {}, params: Record<string, string> = {}): Promise<T> {
  if (!config.key) throw new Error('Trello needs your API key as well as the token.');
  const res = await check(await fetch(trelloUrl(path, config.key, token, params), init), 'Trello');
  return (await res.json()) as T;
}

// ---------- HubSpot (REST; private app token as Bearer) ----------

export async function hubspot<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await check(
    await fetch(`https://api.hubapi.com${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } }),
    'HubSpot',
  );
  return (res.status === 204 ? {} : await res.json()) as T;
}

/** A due date for HubSpot tasks (ms epoch), from YYYY-MM-DD or a week from now. */
export function hubspotDue(due: string | null | undefined, now = Date.now()): string {
  if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) return String(new Date(`${due}T17:00:00Z`).getTime());
  return String(now + 7 * 86400_000);
}

// ---------- Public API ----------

/** Validate a token and return the account name to show in the app. */
export async function verifyToken(provider: Provider, token: string, config: Config): Promise<string> {
  if (provider === 'linear') {
    const d = await linear<{ viewer: { name: string; email: string } }>(token, '{ viewer { name email } }');
    return d.viewer.email || d.viewer.name;
  }
  if (provider === 'asana') {
    const me = await asana<{ name: string; email: string }>(token, '/users/me');
    return me.email || me.name;
  }
  if (provider === 'monday') {
    const d = await monday<{ me: { email: string; name: string } }>(token, '{ me { email name } }');
    return d.me.email || d.me.name;
  }
  if (provider === 'clickup') {
    const d = await clickup<{ user: { email: string; username: string } }>(token, '/user');
    return d.user.email || d.user.username;
  }
  if (provider === 'trello') {
    const d = await trello<{ email?: string; fullName: string; username: string }>(token, config, '/members/me', {}, { fields: 'email,fullName,username' });
    return d.email || d.fullName || d.username;
  }
  if (provider === 'hubspot') {
    const d = await hubspot<{ portalId: number; uiDomain?: string }>(token, '/account-info/v3/details');
    return `HubSpot account ${d.portalId}`;
  }
  if (provider === 'jira') {
    const me = await jira<{ displayName: string; emailAddress?: string }>(token, config, '/myself');
    return me.emailAddress || me.displayName;
  }
  throw new Error(`${provider} connects by signing in, not with a token.`);
}

/** Places a task can be created: Linear teams, Asana projects, Jira projects. */
export async function listTargets(provider: Provider, token: string, config: Config): Promise<Target[]> {
  if (provider === 'linear') {
    const d = await linear<{ teams: { nodes: { id: string; name: string; key: string }[] } }>(token, '{ teams(first: 100) { nodes { id name key } } }');
    return d.teams.nodes.map((t) => ({ id: t.id, name: `${t.name} (${t.key})` }));
  }
  if (provider === 'asana') {
    const me = await asana<{ workspaces: { gid: string; name: string }[] }>(token, '/users/me?opt_fields=workspaces.name');
    const out: Target[] = [];
    for (const ws of me.workspaces.slice(0, 5)) {
      const projects = await asana<{ gid: string; name: string }[]>(token, `/projects?workspace=${ws.gid}&archived=false&limit=100`);
      out.push(...projects.map((p) => ({ id: p.gid, name: me.workspaces.length > 1 ? `${ws.name} / ${p.name}` : p.name })));
    }
    return out;
  }
  if (provider === 'monday') {
    const d = await monday<{ boards: { id: string; name: string }[] }>(token, '{ boards(limit: 100, state: active) { id name } }');
    return d.boards.map((b) => ({ id: b.id, name: b.name }));
  }
  if (provider === 'clickup') {
    const out: Target[] = [];
    const { teams } = await clickup<{ teams: { id: string; name: string }[] }>(token, '/team');
    for (const team of teams.slice(0, 3)) {
      const { spaces } = await clickup<{ spaces: { id: string; name: string }[] }>(token, `/team/${team.id}/space?archived=false`);
      for (const sp of spaces.slice(0, 10)) {
        const { lists } = await clickup<{ lists: { id: string; name: string }[] }>(token, `/space/${sp.id}/list?archived=false`);
        out.push(...lists.map((l) => ({ id: l.id, name: `${sp.name} / ${l.name}` })));
        const { folders } = await clickup<{ folders: { name: string; lists: { id: string; name: string }[] }[] }>(token, `/space/${sp.id}/folder?archived=false`);
        for (const f of folders) out.push(...f.lists.map((l) => ({ id: l.id, name: `${sp.name} / ${f.name} / ${l.name}` })));
      }
    }
    return out;
  }
  if (provider === 'trello') {
    const boards = await trello<{ id: string; name: string }[]>(token, config, '/members/me/boards', {}, { fields: 'name', filter: 'open' });
    const out: Target[] = [];
    for (const b of boards.slice(0, 20)) {
      const lists = await trello<{ id: string; name: string }[]>(token, config, `/boards/${b.id}/lists`, {}, { fields: 'name', filter: 'open' });
      out.push(...lists.map((l) => ({ id: l.id, name: `${b.name} / ${l.name}` })));
    }
    return out;
  }
  if (provider === 'hubspot') return [{ id: 'tasks', name: 'HubSpot tasks' }];
  const d = await jira<{ values: { key: string; name: string }[] }>(token, config, '/project/search?maxResults=100');
  return d.values.map((p) => ({ id: p.key, name: `${p.name} (${p.key})` }));
}

export async function createIssue(provider: Provider, token: string, config: Config, input: IssueInput): Promise<Created> {
  const target = config.target;
  if (!target) throw new Error('Choose where tasks should go in Settings → Task trackers.');

  if (provider === 'linear') {
    const d = await linear<{ issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } } }>(
      token,
      'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }',
      { input: { teamId: target.id, title: input.title, description: input.description, ...(input.dueDate ? { dueDate: input.dueDate } : {}) } },
    );
    if (!d.issueCreate.success) throw new Error('Linear did not create the issue');
    return { id: d.issueCreate.issue.id, key: d.issueCreate.issue.identifier, url: d.issueCreate.issue.url };
  }

  if (provider === 'asana') {
    const task = await asana<{ gid: string; permalink_url: string }>(token, '/tasks?opt_fields=permalink_url', {
      method: 'POST',
      body: JSON.stringify({ data: { name: input.title, notes: input.description, projects: [target.id], ...(input.dueDate ? { due_on: input.dueDate } : {}) } }),
    });
    return { id: task.gid, url: task.permalink_url };
  }

  if (provider === 'monday') {
    const d = await monday<{ create_item: { id: string } }>(token, 'mutation($b: ID!, $n: String!) { create_item(board_id: $b, item_name: $n) { id } }', { b: target.id, n: input.title.slice(0, 255) });
    await monday(token, 'mutation($i: ID!, $body: String!) { create_update(item_id: $i, body: $body) { id } }', { i: d.create_item.id, body: input.description.replace(/\n/g, '<br>') }).catch(() => null);
    const me = await monday<{ me: { account: { slug: string } } }>(token, '{ me { account { slug } } }').catch(() => null);
    const slug = me?.me.account.slug;
    return { id: d.create_item.id, url: slug ? `https://${slug}.monday.com/boards/${target.id}/pulses/${d.create_item.id}` : `https://monday.com/boards/${target.id}` };
  }
  if (provider === 'clickup') {
    const due = input.dueDate ? new Date(`${input.dueDate}T17:00:00Z`).getTime() : undefined;
    const task = await clickup<{ id: string; url: string }>(token, `/list/${target.id}/task`, {
      method: 'POST',
      body: JSON.stringify({ name: input.title.slice(0, 255), description: input.description, ...(due ? { due_date: due } : {}) }),
    });
    return { id: task.id, url: task.url };
  }
  if (provider === 'trello') {
    const card = await trello<{ id: string; shortUrl: string }>(token, config, '/cards', { method: 'POST' }, {
      idList: target.id,
      name: input.title.slice(0, 16384),
      desc: input.description,
      ...(input.dueDate ? { due: `${input.dueDate}T17:00:00.000Z` } : {}),
    });
    return { id: card.id, url: card.shortUrl };
  }
  if (provider === 'hubspot') {
    const t = await hubspot<{ id: string }>(token, '/crm/v3/objects/tasks', {
      method: 'POST',
      body: JSON.stringify({
        properties: { hs_task_subject: input.title.slice(0, 250), hs_task_body: input.description, hs_task_status: 'NOT_STARTED', hs_timestamp: hubspotDue(input.dueDate) },
      }),
    });
    const acct = await hubspot<{ portalId: number; uiDomain?: string }>(token, '/account-info/v3/details').catch(() => null);
    return { id: t.id, url: acct ? `https://${acct.uiDomain ?? 'app.hubspot.com'}/contacts/${acct.portalId}/record/0-27/${t.id}` : 'https://app.hubspot.com' };
  }
  if (provider !== 'jira') throw new Error(`Use the ${provider} connection to send tasks.`);
  const issue = await jira<{ id: string; key: string }>(token, config, '/issue', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        project: { key: target.id },
        summary: input.title.slice(0, 250),
        issuetype: { name: 'Task' },
        description: toAdf(input.description),
        ...(input.dueDate ? { duedate: input.dueDate } : {}),
      },
    }),
  });
  return { id: issue.id, key: issue.key, url: `https://${jiraSite(config.site ?? '')}/browse/${issue.key}` };
}

/** The text sent with each task: who, when, the exact words, and where it came from. */
export function describeTask(
  task: { owner: string | null; due_text: string | null; quote: string | null; quote_ms: number | null },
  recording: { title: string; created_at: string },
  link: string | null,
): string {
  const lines: string[] = [];
  if (task.owner) lines.push(`Owner: ${task.owner}`);
  if (task.due_text) lines.push(`Due: ${task.due_text}`);
  if (task.quote) {
    const at = task.quote_ms != null ? ` (at ${Math.floor(task.quote_ms / 60000)}:${String(Math.floor((task.quote_ms % 60000) / 1000)).padStart(2, '0')})` : '';
    lines.push(`Said${at}: "${task.quote}"`);
  }
  lines.push(`From: ${recording.title}, ${recording.created_at.slice(0, 10)}`);
  if (link) lines.push(link);
  return lines.join('\n');
}
