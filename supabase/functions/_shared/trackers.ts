// Task tracker adapters (personal-token auth). Each one can: check a token, list where
// tasks can go, and create a task. Request building is kept pure where possible.

export type Provider = 'asana' | 'linear' | 'jira';
export type Target = { id: string; name: string };
export type Created = { id: string; key?: string; url: string };
export type IssueInput = {
  title: string;
  description: string; // plain text, may contain newlines
  dueDate?: string | null; // YYYY-MM-DD
};
/** Non-secret settings saved alongside the token. */
export type Config = { account?: string; target?: Target; site?: string; email?: string; workspace?: string };

export const PROVIDERS: Provider[] = ['asana', 'linear', 'jira'];

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
  const me = await jira<{ displayName: string; emailAddress?: string }>(token, config, '/myself');
  return me.emailAddress || me.displayName;
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
