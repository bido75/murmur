import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { Button, Card, T } from '@/components/ui';
import {
  calendarProviders, createWorkspace, disconnectCalendar, getSettings, listCalendarConnections, listWorkspaces, saveSettings,
  startCalendarConnect, type Settings,
} from '@/lib/api';
import { calendarReturnUrl } from '@/lib/calendarUi';
import { APP_NAME } from '@/lib/config';
import { confirm, isWeb, notify } from '@/lib/dialog';
import { supabase } from '@/lib/supabase';
import { flush, pendingOps } from '@/lib/sync';
import { radius, space, useTheme } from '@/lib/theme';
import { CAL_LABELS, TEMPLATE_LABELS, type CalProvider, type Template, type Workspace } from '@/lib/types';

export default function SettingsScreen() {
  const t = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [teams, setTeams] = useState<Workspace[]>([]);
  const [teamName, setTeamName] = useState('');
  const [calProviders, setCalProviders] = useState<CalProvider[]>([]);
  const [calendars, setCalendars] = useState<{ provider: CalProvider; account_email: string | null }[]>([]);

  useEffect(() => {
    getSettings().then(setSettings);
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    pendingOps().then((ops) => setPending(ops.filter((o) => o.kind === 'segment').length));
    listWorkspaces().then(setTeams).catch(() => setTeams([]));
    calendarProviders().then(setCalProviders);
    listCalendarConnections().then(setCalendars).catch(() => setCalendars([]));
  }, []);

  async function connectCalendar(provider: CalProvider) {
    try {
      const url = await startCalendarConnect(provider, calendarReturnUrl());
      if (isWeb) window.location.assign(url);
      else await Linking.openURL(url);
    } catch (e) {
      notify("Couldn't start calendar sign-in", (e as Error).message);
    }
  }

  async function removeCalendar(provider: CalProvider) {
    if (!(await confirm(`Disconnect ${CAL_LABELS[provider]}?`, 'Upcoming meetings and briefs from it will stop showing.', 'Disconnect', true))) return;
    await disconnectCalendar(provider).catch((e) => notify("Couldn't disconnect", (e as Error).message));
    setCalendars(await listCalendarConnections().catch(() => []));
  }

  async function addTeam() {
    try {
      const id = await createWorkspace(teamName);
      setTeamName('');
      router.push({ pathname: '/team/[id]', params: { id } });
    } catch (e) {
      notify("Couldn't create team", (e as Error).message);
    }
  }

  function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveSettings(next);
  }

  if (!settings) return null;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <T weight="600">Recording notice</T>
            <T muted size={14}>Remind me to tell people before I record</T>
          </View>
          <Switch
            value={settings.consentReminder}
            onValueChange={(v) => update({ consentReminder: v })}
            trackColor={{ true: t.accent, false: t.border }}
            accessibilityLabel="Recording notice reminder"
          />
        </View>
      </Card>

      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <T weight="600">Field mode</T>
            <T muted size={14}>Big buttons you can hit with gloves on, a large photo button, and site walks as the default type.</T>
          </View>
          <Switch
            value={settings.fieldMode}
            onValueChange={(v) => update(v ? { fieldMode: true, defaultTemplate: 'site_walk' } : { fieldMode: false })}
            trackColor={{ true: t.accent, false: t.border }}
            accessibilityLabel="Field mode"
          />
        </View>
      </Card>

      <Card style={{ gap: space.md }}>
        <T weight="600">Default type</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {(Object.keys(TEMPLATE_LABELS) as Template[]).map((k) => {
            const on = settings.defaultTemplate === k;
            return (
              <Pressable
                key={k}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => update({ defaultTemplate: k })}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : 'transparent' }}
              >
                <T size={14} style={{ color: on ? t.accent : t.ink }}>{TEMPLATE_LABELS[k]}</T>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Calendar</T>
        <T muted size={14}>See upcoming meetings with a brief: what&apos;s still open and what was decided last time.</T>
        {calendars.map((c) => (
          <View key={c.provider} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <T>{CAL_LABELS[c.provider]}</T>
              {c.account_email ? <T muted size={13}>{c.account_email}</T> : null}
            </View>
            <Button label="Disconnect" kind="ghost" onPress={() => void removeCalendar(c.provider)} />
          </View>
        ))}
        {calProviders
          .filter((p) => !calendars.some((c) => c.provider === p))
          .map((p) => (
            <Button key={p} label={`Connect ${CAL_LABELS[p]}`} kind="secondary" onPress={() => void connectCalendar(p)} />
          ))}
        {calendars.length > 0 && <Button label="Upcoming meetings" kind="ghost" onPress={() => router.push('/upcoming')} />}
        {calProviders.length === 0 && calendars.length === 0 && (
          <T muted size={13}>Calendar sign-in isn&apos;t set up on the server yet (see README: Google/Microsoft app registration).</T>
        )}
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Teams</T>
        <T muted size={14}>Share projects with your team. Everyone sees the team’s recordings, notes and tasks.</T>
        {teams.map((w) => (
          <Pressable key={w.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/team/[id]', params: { id: w.id } })}>
            <View style={{ flexDirection: 'row', paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: t.border }}>
              <T style={{ flex: 1 }}>{w.name}</T>
              <T muted size={13}>{w.role}</T>
            </View>
          </Pressable>
        ))}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput
            value={teamName}
            onChangeText={setTeamName}
            placeholder="New team name"
            placeholderTextColor={t.muted}
            style={{ flex: 1, borderWidth: 1, borderColor: t.border, color: t.ink, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, minHeight: 44 }}
            accessibilityLabel="New team name"
          />
          <Button label="Create" kind="secondary" onPress={addTeam} disabled={!teamName.trim()} style={{ minHeight: 44 }} />
        </View>
        <Button label="Join a team with a code" kind="ghost" onPress={() => router.push('/join')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Claude, ChatGPT and other AI tools</T>
        <T muted size={14}>Let your AI assistant search your recordings and tasks.</T>
        <Button label="Set up access" kind="secondary" onPress={() => router.push('/api-access')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Connections</T>
        <T muted size={14}>Task trackers (Procore, Asana, Linear, Jira, monday.com, ClickUp, Trello), Slack, Notion, Google Docs, OneNote, HubSpot and Salesforce.</T>
        <Button label="Manage connections" kind="secondary" onPress={() => router.push('/integrations')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Highlight reels</T>
        <T muted size={14}>Clips from several recordings, in one place to play or share.</T>
        <Button label="Open" kind="secondary" onPress={() => router.push('/reels')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Phone calls</T>
        <T muted size={14}>Record calls through your Murmur number, or import calls from Aircall.</T>
        <Button label="Set up" kind="secondary" onPress={() => router.push('/phone')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Devices</T>
        <T muted size={14}>Link the browser extension, an Apple Watch or a Wear OS watch.</T>
        <Button label="Manage devices" kind="secondary" onPress={() => router.push('/devices')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Automations</T>
        <T muted size={14}>When notes are ready: post to Slack, email the recap, send tasks, save to Notion, or call Zapier.</T>
        <Button label="Manage automations" kind="secondary" onPress={() => router.push('/automations')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Alerts, digest & automatic notetaker</T>
        <T muted size={14}>Get told when a topic comes up, a Monday summary email, and a notetaker for every calendar meeting.</T>
        <Button label="Open" kind="secondary" onPress={() => router.push('/alerts')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Webhooks & REST API</T>
        <T muted size={14}>For developers: signed webhooks and a read API over your recordings and tasks.</T>
        <Button label="Open" kind="secondary" onPress={() => router.push('/developers')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Summary templates</T>
        <T muted size={14}>Your own note formats (e.g. OAC meetings, 1:1s), for you or your whole team.</T>
        <Button label="Manage templates" kind="secondary" onPress={() => router.push('/templates')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Privacy & data</T>
        <T muted size={14}>Where you record (for consent warnings), how long to keep audio and recordings, delete your account.</T>
        <Button label="Open" kind="secondary" onPress={() => router.push('/privacy')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Uploads</T>
        <T muted size={14}>{pending ? `${pending} audio part${pending > 1 ? 's' : ''} waiting to upload.` : 'Everything is uploaded.'}</T>
        {pending > 0 && <Button label="Retry now" kind="secondary" onPress={() => void flush().then(() => pendingOps()).then((o) => setPending(o.filter((x) => x.kind === 'segment').length))} />}
      </Card>

      <Card style={{ gap: space.sm }}>
        <T weight="600">Account</T>
        <T muted size={14}>{email ?? ''}</T>
        <T muted size={13}>Your recordings are private to your account and are never used to train AI models.</T>
        <Button
          label="Sign out"
          kind="secondary"
          onPress={async () => {
            const ok = await confirm('Sign out?', 'Recordings waiting to upload stay on this device and upload after you sign back in.', 'Sign out', true);
            if (ok) void supabase.auth.signOut();
          }}
        />
      </Card>

      <T muted size={12} style={{ textAlign: 'center' }}>{APP_NAME} · MVP build</T>
    </ScrollView>
  );
}
