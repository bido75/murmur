import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { ActionMenu, type MenuAction } from '@/components/ActionMenu';
import { Button, Card, Segmented, T } from '@/components/ui';
import { currentUserId, getWorkspace, inviteMember, prettyCode, removeMember, renameWorkspace, revokeInvite, setMemberRole } from '@/lib/api';
import { APP_NAME } from '@/lib/config';
import { confirm, notify, shareOrCopy } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';
import type { Member } from '@/lib/types';

type Data = Awaited<ReturnType<typeof getWorkspace>>;

export default function Team() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const [data, setData] = useState<Data | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ title: string; actions: MenuAction[] } | null>(null);

  const load = useCallback(
    () =>
      Promise.all([getWorkspace(id), currentUserId()])
        .then(([d, uid]) => {
          setData(d);
          setMe(uid);
          if (d.workspace) setName((n) => n || d.workspace!.name);
        })
        .catch((e) => notify("Couldn't load team", (e as Error).message)),
    [id],
  );
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const myRole = data?.members.find((m) => m.user_id === me)?.role;
  const isAdmin = myRole === 'owner' || myRole === 'admin';

  async function invite() {
    setBusy(true);
    try {
      const code = await inviteMember(id, email, role);
      const msg = `Join ${data?.workspace?.name ?? 'my team'} on ${APP_NAME}. Sign in with ${email.trim()}, then go to Settings → Join a team and enter code ${prettyCode(code)}. It expires in 14 days.`;
      setEmail('');
      await load();
      await shareOrCopy(msg, 'Invite copied');
    } catch (e) {
      notify("Couldn't create invite", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function memberMenu(m: Member) {
    const actions: MenuAction[] = [];
    const run = (fn: () => Promise<void>) => () => void fn().then(load).catch((e) => notify('Something went wrong', (e as Error).message));
    if (isAdmin && m.user_id !== me) {
      if (m.role !== 'admin') actions.push({ label: 'Make admin', onPress: run(() => setMemberRole(id, m.user_id, 'admin')) });
      if (m.role !== 'member') actions.push({ label: 'Make member', onPress: run(() => setMemberRole(id, m.user_id, 'member')) });
      if (myRole === 'owner' && m.role !== 'owner') actions.push({ label: 'Make owner', onPress: run(() => setMemberRole(id, m.user_id, 'owner')) });
      actions.push({
        label: 'Remove from team',
        destructive: true,
        onPress: async () => {
          if (await confirm('Remove from team?', `${m.email ?? 'They'} will lose access to this team's projects. Their own recordings stay theirs.`, 'Remove', true)) {
            await removeMember(id, m.user_id).then(load).catch((e) => notify("Couldn't remove", (e as Error).message));
          }
        },
      });
    }
    if (actions.length) setMenu({ title: m.email ?? 'Member', actions });
  }

  async function leave() {
    if (!me) return;
    if (!(await confirm('Leave this team?', "You'll lose access to its shared projects. Your own recordings stay yours.", 'Leave', true))) return;
    try {
      await removeMember(id, me);
      router.back();
    } catch (e) {
      notify("Couldn't leave", (e as Error).message);
    }
  }

  if (!data) return null;
  const input = { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 } as const;

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }}>
        <TextInput
          value={name}
          editable={isAdmin}
          onChangeText={setName}
          onEndEditing={() => isAdmin && name.trim() && name !== data.workspace?.name && void renameWorkspace(id, name).catch((e) => notify("Couldn't rename", (e as Error).message))}
          style={{ color: t.ink, fontSize: 26, fontWeight: '700' }}
          accessibilityLabel="Team name"
        />
        <T muted>
          Everyone here can see the team&apos;s projects: recordings, transcripts, notes and tasks. Only the person who made a recording can delete or re-run it.
        </T>

        <View style={{ gap: space.sm }}>
          <T muted size={13} weight="600">MEMBERS ({data.members.length})</T>
          {data.members.map((m) => (
            <Pressable key={m.user_id} onPress={() => memberMenu(m)} disabled={!isAdmin || m.user_id === me} accessibilityRole="button">
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <T style={{ flex: 1 }} numberOfLines={1}>{m.email ?? 'Member'}{m.user_id === me ? ' (you)' : ''}</T>
                <T muted size={13}>{m.role}</T>
              </Card>
            </Pressable>
          ))}
        </View>

        {isAdmin && (
          <Card style={{ gap: space.md }}>
            <T weight="600">Invite someone</T>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Their email address"
              placeholderTextColor={t.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              style={input}
              accessibilityLabel="Invitee email"
            />
            <Segmented<'member' | 'admin'>
              value={role}
              onChange={setRole}
              options={[
                { key: 'member', label: 'Member' },
                { key: 'admin', label: 'Admin (can invite)' },
              ]}
            />
            <Button label="Create invite" onPress={invite} loading={busy} disabled={!email.includes('@')} />
            <T muted size={13}>You get a code to send them. It only works for that email address.</T>
          </Card>
        )}

        {isAdmin && data.invites.length > 0 && (
          <View style={{ gap: space.sm }}>
            <T muted size={13} weight="600">PENDING INVITES</T>
            {data.invites.map((inv) => (
              <Card key={inv.id} style={{ gap: space.xs }}>
                <T>{inv.email}</T>
                <T muted size={13}>Code {prettyCode(inv.code)} · {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}</T>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="Share again" kind="ghost" onPress={() => void shareOrCopy(`Your invite code for ${data.workspace?.name}: ${prettyCode(inv.code)}`, 'Code copied')} style={{ flex: 1 }} />
                  <Button label="Revoke" kind="ghost" onPress={() => void revokeInvite(inv.id).then(load).catch((e) => notify("Couldn't revoke", (e as Error).message))} style={{ flex: 1 }} />
                </View>
              </Card>
            ))}
          </View>
        )}

        <Button label="Leave team" kind="ghost" onPress={leave} />
      </ScrollView>
      <ActionMenu visible={!!menu} title={menu?.title} actions={menu?.actions ?? []} onClose={() => setMenu(null)} />
    </>
  );
}
