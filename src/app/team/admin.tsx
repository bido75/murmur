import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { ToggleRow } from '@/components/ToggleRow';
import { Banner, Button, Card, Empty, Segmented, T } from '@/components/ui';
import {
  addDomain,
  auditEvents,
  createScimToken,
  getPolicy,
  listDomains,
  listScimTokens,
  removeDomain,
  revokeScimToken,
  savePolicy,
  scimBaseUrl,
  setDomainAutoJoin,
  verifyDomain,
  workspaceUsage,
  type AuditEvent,
  type Domain,
  type Policy,
  type UsageRow,
} from '@/lib/api';
import { confirm, notify, shareOrCopy } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';

type Tab = 'usage' | 'policy' | 'audit' | 'sso';

export default function Admin() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('usage');
  return (
    <>
      <Stack.Screen options={{ title: 'Admin console' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { key: 'usage', label: 'Usage' },
            { key: 'policy', label: 'Policies' },
            { key: 'audit', label: 'Audit' },
            { key: 'sso', label: 'Sign-in' },
          ]}
        />
        {tab === 'usage' && <Usage ws={id} />}
        {tab === 'policy' && <Policies ws={id} />}
        {tab === 'audit' && <Audit ws={id} />}
        {tab === 'sso' && <SignIn ws={id} />}
      </ScrollView>
    </>
  );
}

function Usage({ ws }: { ws: string }) {
  const t = useTheme();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  useEffect(() => {
    workspaceUsage(ws, Number(days))
      .then(setRows)
      .catch((e) => notify("Couldn't load usage", (e as Error).message));
  }, [ws, days]);
  const total = (rows ?? []).reduce((a, r) => ({ recs: a.recs + r.recordings, mins: a.mins + r.minutes, active: a.active + (r.recordings > 0 ? 1 : 0) }), { recs: 0, mins: 0, active: 0 });
  return (
    <>
      <Segmented value={days} onChange={setDays} options={[{ key: '7', label: '7 days' }, { key: '30', label: '30 days' }, { key: '90', label: '90 days' }]} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {[
          ['Recordings', String(total.recs)],
          ['Hours', (total.mins / 60).toFixed(1)],
          ['Active', `${total.active}/${rows?.length ?? 0}`],
        ].map(([k, v]) => (
          <Card key={k} style={{ flex: 1, gap: 2, alignItems: 'center' }}>
            <T size={22} weight="700">{v}</T>
            <T muted size={13}>{k}</T>
          </Card>
        ))}
      </View>
      <Card style={{ gap: space.xs }}>
        <T weight="600">By person</T>
        <T muted size={13}>Recordings in this team’s projects only. Personal recordings stay private.</T>
        {(rows ?? []).map((r) => (
          <View key={r.user_id} style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: t.border }}>
            <View style={{ flex: 1 }}>
              <T numberOfLines={1}>{r.email ?? 'Unknown'}</T>
              <T muted size={13}>{r.role}{r.last_recording_at ? ` · last ${new Date(r.last_recording_at).toLocaleDateString()}` : ' · no recordings'}</T>
            </View>
            <T>{r.recordings} · {Math.round(r.minutes)} min</T>
          </View>
        ))}
      </Card>
    </>
  );
}

const REDACT = [
  { key: 'pii', label: 'Personal details' },
  { key: 'phi', label: 'Health information' },
  { key: 'pci', label: 'Card and bank numbers' },
  { key: 'numbers', label: 'All long numbers' },
];
const DAYS: { label: string; value: number | null }[] = [
  { label: 'Forever', value: null },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: '3 years', value: 1095 },
  { label: '7 years', value: 2555 },
];

function Policies({ ws }: { ws: string }) {
  const t = useTheme();
  const [p, setP] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    getPolicy(ws)
      .then((x) => setP(x ?? { workspace_id: ws, redact: [], audio_retention_days: null, recording_retention_days: null, allow_public_links: true, max_link_days: null, require_consent: false }))
      .catch((e) => notify("Couldn't load", (e as Error).message));
  }, [ws]);
  if (!p) return null;

  async function save(next: Policy) {
    const shorter = (a: number | null, b: number | null) => a != null && (b == null || a < b);
    if (shorter(next.recording_retention_days, p!.recording_retention_days) || shorter(next.audio_retention_days, p!.audio_retention_days)) {
      if (!(await confirm('Delete older material?', 'Team-project recordings older than this are deleted at the next daily cleanup, for everyone.', 'Apply', true))) return;
    }
    if (!next.allow_public_links && p!.allow_public_links) {
      if (!(await confirm('Turn off public links?', 'Every active public link to this team’s recordings stops working now.', 'Turn off', true))) return;
    }
    setSaving(true);
    try {
      await savePolicy(next);
      setP(next);
    } catch (e) {
      notify("Couldn't save", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const chips = (value: number | null, onPick: (v: number | null) => void, opts = DAYS) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {opts.map((o) => (
        <Pressable key={o.label} disabled={saving} onPress={() => onPick(o.value)} accessibilityRole="radio" accessibilityState={{ selected: value === o.value }}
          style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: value === o.value ? t.accent : t.border, backgroundColor: value === o.value ? t.accentSoft : 'transparent' }}>
          <T size={14}>{o.label}</T>
        </Pressable>
      ))}
    </View>
  );

  return (
    <>
      <T muted>These apply to every recording in this team’s projects, on top of each person’s own settings (the stricter one wins).</T>
      <Card style={{ gap: space.md }}>
        <T weight="600">Remove from transcripts</T>
        {REDACT.map((r) => (
          <ToggleRow key={r.key} label={r.label} value={p.redact.includes(r.key)} onChange={(on) => void save({ ...p, redact: on ? [...p.redact, r.key] : p.redact.filter((x) => x !== r.key) })} />
        ))}
      </Card>
      <Card style={{ gap: space.md }}>
        <T weight="600">Keep audio for</T>
        {chips(p.audio_retention_days, (v) => void save({ ...p, audio_retention_days: v }))}
        <T weight="600">Keep recordings, notes and tasks for</T>
        {chips(p.recording_retention_days, (v) => void save({ ...p, recording_retention_days: v }))}
      </Card>
      <Card style={{ gap: space.md }}>
        <T weight="600">Sharing</T>
        <ToggleRow label="Allow public links" hint="Off: nobody can share team recordings by link, and existing links stop working" value={p.allow_public_links} onChange={(v) => void save({ ...p, allow_public_links: v })} />
        {p.allow_public_links && (
          <>
            <T muted size={14}>Links expire after at most:</T>
            {chips(p.max_link_days, (v) => void save({ ...p, max_link_days: v }), [{ label: 'No limit', value: null }, { label: '7 days', value: 7 }, { label: '30 days', value: 30 }, { label: '90 days', value: 90 }])}
          </>
        )}
      </Card>
      <Card style={{ gap: space.md }}>
        <T weight="600">Consent</T>
        <ToggleRow label="Require a consent choice before recording" hint="People must say how attendees were told before recording into a team project" value={p.require_consent} onChange={(v) => void save({ ...p, require_consent: v })} />
      </Card>
    </>
  );
}

const ACTION_LABELS: Record<string, string> = {
  'member.added': 'added a member',
  'member.removed': 'removed a member',
  'member.role_changed': 'changed a role',
  'invite.created': 'invited someone',
  'invite.removed': 'removed an invite',
  'policy.updated': 'changed team policies',
  'share_link.created': 'made a public link',
  'share_link.revoked': 'turned off a public link',
  'recording.deleted': 'deleted a recording',
  'recording.moved_in': 'moved a recording into the team',
  'recording.moved_out': 'moved a recording out of the team',
  'project.created': 'created a project',
  'project.deleted': 'deleted a project',
  'project.moved_in': 'moved a project into the team',
  'project.moved_out': 'moved a project out of the team',
  'domain.verified': 'verified a domain',
  'scim_token.created': 'made a SCIM token',
  'scim.user_added': 'added a member (SCIM)',
  'scim.user_removed': 'removed a member (SCIM)',
};

function describe(e: AuditEvent): string {
  const m = e.meta as Record<string, string | boolean | null>;
  const detail = m.email ?? m.title ?? m.name ?? (e.target_type === 'domain' ? e.target_id : null);
  const extra = e.action === 'member.role_changed' ? ` (${m.from} → ${m.to})` : '';
  return `${e.actor_email ?? (m.source === 'scim' ? 'Identity provider' : 'System')} ${ACTION_LABELS[e.action] ?? e.action}${detail ? `: ${detail}` : ''}${extra}`;
}

function Audit({ ws }: { ws: string }) {
  const t = useTheme();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [more, setMore] = useState(true);
  useEffect(() => {
    auditEvents(ws)
      .then((e) => {
        setEvents(e);
        setMore(e.length === 100);
      })
      .catch((e) => notify("Couldn't load the audit log", (e as Error).message));
  }, [ws]);
  const loadMore = async () => {
    const next = await auditEvents(ws, events?.[events.length - 1]?.id);
    setEvents([...(events ?? []), ...next]);
    setMore(next.length === 100);
  };
  const csv = () =>
    ['time,actor,action,target_type,target_id,details', ...(events ?? []).map((e) => [e.created_at, e.actor_email ?? '', e.action, e.target_type ?? '', e.target_id ?? '', JSON.stringify(e.meta)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
  if (events && !events.length) return <Empty title="Nothing yet" body="Membership, sharing, deletions and policy changes in this team show up here." />;
  return (
    <>
      <Button label="Copy as CSV" kind="ghost" onPress={() => void shareOrCopy(csv(), 'Audit log copied')} />
      <Card style={{ gap: 0 }}>
        {(events ?? []).map((e, i) => (
          <View key={e.id} style={{ paddingVertical: space.sm, borderTopWidth: i ? 1 : 0, borderTopColor: t.border, gap: 2 }}>
            <T size={15}>{describe(e)}</T>
            <T muted size={12}>{new Date(e.created_at).toLocaleString()}</T>
          </View>
        ))}
      </Card>
      {more && events && <Button label="Load older" kind="secondary" onPress={() => void loadMore()} />}
    </>
  );
}

function SignIn({ ws }: { ws: string }) {
  const t = useTheme();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domain, setDomain] = useState('');
  const [tokens, setTokens] = useState<{ id: string; prefix: string; created_at: string; last_used_at: string | null }[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const load = useCallback(() => {
    listDomains(ws).then(setDomains).catch((e) => notify("Couldn't load domains", (e as Error).message));
    listScimTokens(ws).then(setTokens).catch(() => setTokens([]));
  }, [ws]);
  useEffect(() => {
    listDomains(ws).then(setDomains).catch((e) => notify("Couldn't load domains", (e as Error).message));
    listScimTokens(ws).then(setTokens).catch(() => setTokens([]));
  }, [ws]);
  const code = { fontFamily: 'Courier', fontSize: 13, color: t.ink, backgroundColor: t.bg, padding: space.md, borderRadius: radius.sm } as const;

  async function check(d: Domain) {
    try {
      const r = await verifyDomain(d.domain);
      if (r.verified) {
        notify('Domain verified', d.auto_join ? `Anyone who signs in with an @${d.domain} email now joins this team.` : undefined);
        load();
      } else notify('Not found yet', `Add a TXT record on ${d.domain} with the value below. DNS changes can take up to an hour.`);
    } catch (e) {
      notify("Couldn't check", (e as Error).message);
    }
  }

  return (
    <>
      <Card style={{ gap: space.md }}>
        <T weight="600">Company domain</T>
        <T muted size={14}>Verify your email domain so colleagues join this team automatically when they sign in, and to turn on single sign-on.</T>
        {domains.map((d) => (
          <View key={d.domain} style={{ gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: t.border }}>
            <T weight="600">{d.domain} {d.verified_at ? '· verified' : '· not verified'}</T>
            {!d.verified_at && (
              <>
                <T muted size={14}>Add this TXT record to {d.domain}’s DNS, then check:</T>
                <T selectable style={code}>{d.verify_token}</T>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="Copy" kind="ghost" onPress={() => void shareOrCopy(d.verify_token, 'Copied')} style={{ flex: 1 }} />
                  <Button label="Check now" kind="secondary" onPress={() => void check(d)} style={{ flex: 1 }} />
                </View>
              </>
            )}
            <ToggleRow label={`Add new @${d.domain} sign-ins to this team`} value={d.auto_join} onChange={(v) => void setDomainAutoJoin(d.domain, v).then(load).catch((e) => notify("Couldn't save", (e as Error).message))} />
            {d.verified_at && (
              <T muted size={13}>
                Single sign-on: {d.sso_provider_id ? `on${d.sso_required ? ' (required)' : ''}` : 'not set up'}. To connect Okta, Entra ID or Google Workspace via SAML, send your IdP metadata URL to your Murmur administrator (docs/security/sso.md).
              </T>
            )}
            <Button label="Remove" kind="ghost" onPress={() => void confirm(`Remove ${d.domain}?`, 'Automatic joining and single sign-on for it stop.', 'Remove', true).then(async (ok) => { if (ok) { await removeDomain(d.domain); load(); } })} />
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput value={domain} onChangeText={setDomain} placeholder="acme.com" placeholderTextColor={t.muted} autoCapitalize="none" keyboardType="url"
            style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, minHeight: 44 }} accessibilityLabel="Domain" />
          <Button label="Add" kind="secondary" disabled={!domain.includes('.')} onPress={() => void addDomain(ws, domain).then(() => { setDomain(''); load(); }).catch((e) => notify("Couldn't add", (e as Error).message))} style={{ minHeight: 44 }} />
        </View>
      </Card>

      <Card style={{ gap: space.md }}>
        <T weight="600">SCIM provisioning</T>
        <T muted size={14}>Let Okta, Entra ID or OneLogin add and remove team members automatically. Use this base URL and a token:</T>
        <T selectable style={code}>{scimBaseUrl()}</T>
        {fresh && (
          <>
            <Banner text="Copy this token now. It won't be shown again." />
            <T selectable style={code}>{fresh}</T>
            <Button label="Copy token" kind="secondary" onPress={() => void shareOrCopy(fresh, 'Token copied')} />
          </>
        )}
        {tokens.map((tk) => (
          <View key={tk.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <T>{tk.prefix}…</T>
              <T muted size={13}>{tk.last_used_at ? `last used ${new Date(tk.last_used_at).toLocaleDateString()}` : 'never used'}</T>
            </View>
            <Button label="Revoke" kind="ghost" onPress={() => void confirm('Revoke this SCIM token?', 'Provisioning from your identity provider stops until you add a new one.', 'Revoke', true).then(async (ok) => { if (ok) { await revokeScimToken(tk.id); load(); } })} />
          </View>
        ))}
        <Button label="Create SCIM token" kind="secondary" onPress={() => void createScimToken(ws).then((tk) => { setFresh(tk); load(); }).catch((e) => notify("Couldn't create", (e as Error).message))} />
      </Card>
    </>
  );
}
