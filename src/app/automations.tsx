import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { ActionMenu, type MenuAction } from '@/components/ActionMenu';
import { ToggleRow } from '@/components/ToggleRow';
import { Button, Card, Empty, T } from '@/components/ui';
import { deleteAutomation, listAutomations, listIntegrations, listProjects, saveAutomation, type Automation, type AutomationAction } from '@/lib/api';
import { confirm, notify } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';
import { PROVIDER_LABELS, TEMPLATE_LABELS, TRACKERS, type ConnKey, type Integration, type Project, type Provider, type Template } from '@/lib/types';

type Draft = { id?: string; name: string; project_id: string | null; template: string | null; active: boolean; slack: boolean; emails: string; tracker: string | null; exports: string[]; webhook: string };

const EXPORTS = ['notion', 'google_docs', 'onenote', 'hubspot', 'salesforce'] as const;
const EMPTY: Draft = { name: '', project_id: null, template: null, active: true, slack: false, emails: '', tracker: null, exports: [], webhook: '' };

function toDraft(a: Automation): Draft {
  const d: Draft = { ...EMPTY, id: a.id, name: a.name, project_id: a.project_id, template: a.template, active: a.active };
  for (const x of a.actions) {
    if (x.type === 'slack') d.slack = true;
    if (x.type === 'email') d.emails = x.to.join(', ');
    if (x.type === 'tracker') d.tracker = x.provider;
    if (x.type === 'export') d.exports.push(x.destination);
    if (x.type === 'webhook') d.webhook = x.url;
  }
  return d;
}

function toActions(d: Draft): AutomationAction[] {
  const out: AutomationAction[] = [];
  if (d.slack) out.push({ type: 'slack' });
  const to = d.emails.split(/[\s,;]+/).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (to.length) out.push({ type: 'email', to });
  if (d.tracker) out.push({ type: 'tracker', provider: d.tracker });
  for (const e of d.exports) out.push({ type: 'export', destination: e as (typeof EXPORTS)[number] });
  if (d.webhook.trim()) out.push({ type: 'webhook', url: d.webhook.trim() });
  return out;
}

function describe(a: Automation, projects: Project[]) {
  const when = [a.project_id ? projects.find((p) => p.id === a.project_id)?.name ?? 'a project' : 'any project', a.template ? TEMPLATE_LABELS[a.template as Template] ?? a.template : 'any type'].join(' · ');
  const what = a.actions
    .map((x) =>
      x.type === 'slack' ? 'post to Slack' : x.type === 'email' ? `email ${x.to.length} ${x.to.length === 1 ? 'person' : 'people'}` : x.type === 'tracker' ? `tasks → ${PROVIDER_LABELS[x.provider as ConnKey] ?? x.provider}` : x.type === 'export' ? `notes → ${PROVIDER_LABELS[x.destination]}` : 'call a webhook',
    )
    .join(', ');
  return `${when}: ${what}`;
}

export default function Automations() {
  const t = useTheme();
  const [list, setList] = useState<Automation[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [conns, setConns] = useState<Integration[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [menu, setMenu] = useState<{ title: string; actions: MenuAction[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => listAutomations().then(setList).catch((e) => notify("Couldn't load automations", (e as Error).message)), []);
  useEffect(() => {
    listAutomations()
      .then(setList)
      .catch((e) => notify("Couldn't load automations", (e as Error).message));
    listProjects().then(setProjects).catch(() => setProjects([]));
    listIntegrations().then(setConns).catch(() => setConns([]));
  }, []);

  const has = (p: string) => conns.some((c) => c.provider === p);
  const trackers = conns.filter((c) => TRACKERS.includes(c.provider as Provider) && (c.config.target || c.provider === 'salesforce'));
  const input = { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 } as const;

  async function save() {
    if (!draft) return;
    const actions = toActions(draft);
    if (!draft.name.trim()) return notify('Give it a name');
    if (!actions.length) return notify('Choose at least one thing to do');
    if (draft.webhook.trim() && !/^https:\/\//.test(draft.webhook.trim())) return notify('Webhook address must start with https://');
    setBusy(true);
    try {
      await saveAutomation({ id: draft.id, name: draft.name, project_id: draft.project_id, template: draft.template, active: draft.active, actions });
      setDraft(null);
      await load();
    } catch (e) {
      notify("Couldn't save", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Automation) {
    if (!(await confirm(`Delete "${a.name}"?`, 'It stops running. Anything it already sent stays.', 'Delete', true))) return;
    await deleteAutomation(a.id).catch((e) => notify("Couldn't delete", (e as Error).message));
    await load();
  }

  if (draft) {
    const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Card style={{ gap: space.md }}>
          <T weight="600">Name</T>
          <TextInput value={draft.name} onChangeText={(name) => set({ name })} placeholder="e.g. Riverside site walks to the PM" placeholderTextColor={t.muted} style={input} accessibilityLabel="Automation name" />
          <T weight="600">When notes are ready for</T>
          <Button
            label={draft.project_id ? projects.find((p) => p.id === draft.project_id)?.name ?? 'Project' : 'Any project'}
            kind="secondary"
            onPress={() => setMenu({ title: 'Project', actions: [{ label: 'Any project', onPress: () => set({ project_id: null }) }, ...projects.map((p) => ({ label: p.name, onPress: () => set({ project_id: p.id }) }))] })}
          />
          <Button
            label={draft.template ? TEMPLATE_LABELS[draft.template as Template] ?? draft.template : 'Any type of recording'}
            kind="secondary"
            onPress={() =>
              setMenu({ title: 'Type of recording', actions: [{ label: 'Any type', onPress: () => set({ template: null }) }, ...(Object.keys(TEMPLATE_LABELS) as Template[]).map((k) => ({ label: TEMPLATE_LABELS[k], onPress: () => set({ template: k }) }))] })
            }
          />
        </Card>

        <Card style={{ gap: space.md }}>
          <T weight="600">Do this</T>
          <ToggleRow label="Post the summary to Slack" hint={has('slack') ? undefined : 'Connect Slack first'} value={draft.slack} onChange={(slack) => (has('slack') || !slack ? set({ slack }) : router.push('/integrations'))} />
          <T muted size={14}>Email the recap to (comma-separated):</T>
          <TextInput value={draft.emails} onChangeText={(emails) => set({ emails })} placeholder="pm@company.com, owner@client.com" placeholderTextColor={t.muted} autoCapitalize="none" keyboardType="email-address" style={input} accessibilityLabel="Recap recipients" />
          <T muted size={14}>Send confirmed tasks to:</T>
          <Button
            label={draft.tracker ? PROVIDER_LABELS[draft.tracker as ConnKey] : trackers.length ? 'No tracker' : 'Connect a tracker first'}
            kind="secondary"
            onPress={() =>
              trackers.length
                ? setMenu({ title: 'Send tasks to', actions: [{ label: 'No tracker', onPress: () => set({ tracker: null }) }, ...trackers.map((c) => ({ label: PROVIDER_LABELS[c.provider], onPress: () => set({ tracker: c.provider }) }))] })
                : router.push('/integrations')
            }
          />
          {EXPORTS.filter(has).map((d) => (
            <ToggleRow
              key={d}
              label={d === 'hubspot' || d === 'salesforce' ? `Log in ${PROVIDER_LABELS[d]}` : `Save notes to ${PROVIDER_LABELS[d]}`}
              hint={d === 'hubspot' || d === 'salesforce' ? 'Matched by attendee emails from the consent link' : undefined}
              value={draft.exports.includes(d)}
              onChange={(on) => set({ exports: on ? [...draft.exports, d] : draft.exports.filter((x) => x !== d) })}
            />
          ))}
          <T muted size={14}>Call a webhook (Zapier, Make, n8n or your own):</T>
          <TextInput value={draft.webhook} onChangeText={(webhook) => set({ webhook })} placeholder="https://hooks.zapier.com/…" placeholderTextColor={t.muted} autoCapitalize="none" keyboardType="url" style={input} accessibilityLabel="Webhook URL" />
        </Card>

        <ToggleRow label="On" value={draft.active} onChange={(active) => set({ active })} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Cancel" kind="ghost" onPress={() => setDraft(null)} style={{ flex: 1 }} />
          <Button label="Save" onPress={save} loading={busy} style={{ flex: 1 }} />
        </View>
        <ActionMenu visible={!!menu} title={menu?.title} actions={menu?.actions ?? []} onClose={() => setMenu(null)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <T muted>Run steps automatically every time notes are ready — post to Slack, email the recap, send tasks to your tracker, save to Notion, or call Zapier.</T>
      <Button label="New automation" onPress={() => setDraft({ ...EMPTY })} />
      {list && !list.length && <Empty title="No automations yet" body="For example: every site walk on Riverside → email the PM and send punch items to Procore." />}
      {(list ?? []).map((a) => (
        <Card key={a.id} style={{ gap: space.sm, opacity: a.active ? 1 : 0.6 }}>
          <T weight="600">{a.name}{a.active ? '' : ' (off)'}</T>
          <T muted size={14}>{describe(a, projects)}</T>
          {a.last_run_at && <T muted size={13}>Last ran {new Date(a.last_run_at).toLocaleString()}{a.last_result ? ` — ${a.last_result}` : ''}</T>}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Edit" kind="secondary" onPress={() => setDraft(toDraft(a))} style={{ flex: 1 }} />
            <Button label="Delete" kind="ghost" onPress={() => void remove(a)} style={{ flex: 1 }} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
