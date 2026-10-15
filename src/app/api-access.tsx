import { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { Banner, Button, Card, T } from '@/components/ui';
import { createApiToken, disconnectApp, listApiTokens, listConnectedApps, revokeApiToken, type ApiToken, type ConnectedApp } from '@/lib/api';
import { APP_NAME, APP_URL, SUPABASE_URL } from '@/lib/config';
import { confirm, notify, shareOrCopy } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';

// With the web app deployed, MCP is served from its domain (see scripts/hosting-config.mjs).
const ENDPOINT = APP_URL ? `${APP_URL}/mcp` : `${SUPABASE_URL}/functions/v1/mcp`;
const SLUG = APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export default function ApiAccess() {
  const t = useTheme();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState('Claude');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apps, setApps] = useState<ConnectedApp[]>([]);

  const reload = () => listApiTokens().then(setTokens).catch((e) => notify("Couldn't load tokens", (e as Error).message));
  useEffect(() => {
    listApiTokens().then(setTokens).catch((e) => notify("Couldn't load tokens", (e as Error).message));
    listConnectedApps().then(setApps).catch(() => setApps([]));
  }, []);

  async function disconnect(app: ConnectedApp) {
    if (!(await confirm(`Disconnect ${app.client_name}?`, 'It loses access immediately. You can connect it again later.', 'Disconnect', true))) return;
    await disconnectApp(app.client_id).catch((e) => notify("Couldn't disconnect", (e as Error).message));
    setApps(await listConnectedApps().catch(() => []));
  }

  async function create() {
    setBusy(true);
    try {
      setFresh(await createApiToken(name));
      await reload();
    } catch (e) {
      notify("Couldn't create token", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(tok: ApiToken) {
    if (!(await confirm(`Revoke "${tok.name}"?`, 'Anything using this token stops working immediately.', 'Revoke', true))) return;
    await revokeApiToken(tok.id).catch((e) => notify("Couldn't revoke", (e as Error).message));
    await reload();
  }

  const shown = fresh ?? '<YOUR_TOKEN>';
  const claudeCode = `claude mcp add --transport http ${SLUG} ${ENDPOINT} --header "Authorization: Bearer ${shown}"`;
  const json = JSON.stringify({ mcpServers: { [SLUG]: { url: ENDPOINT, headers: { Authorization: `Bearer ${shown}` } } } }, null, 2);
  const code = { fontFamily: 'Courier', fontSize: 13, color: t.ink, backgroundColor: t.bg, padding: space.md, borderRadius: radius.sm } as const;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <T muted>
        Give an AI assistant read access to your recordings, notes and tasks (and the ability to tick tasks off). It sees exactly what you see in
        the app, including team projects.
      </T>

      <Card style={{ gap: space.md }}>
        <T weight="600">Claude.ai or ChatGPT (sign in, no token)</T>
        {APP_URL ? (
          <>
            <T muted size={14}>Add a custom connector in Claude (Settings → Connectors) or ChatGPT (connectors / developer mode) with this URL, then sign in when asked:</T>
            <T selectable style={code}>{ENDPOINT}</T>
            <Button label="Copy URL" kind="ghost" onPress={() => void shareOrCopy(ENDPOINT, 'URL copied')} />
          </>
        ) : (
          <T muted size={14}>Available once the web app is deployed and EXPO_PUBLIC_APP_URL is set (see README).</T>
        )}
        {apps.map((a) => (
          <View key={a.client_id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <T>{a.client_name}</T>
              <T muted size={13}>Connected {new Date(a.connected_at).toLocaleDateString()}</T>
            </View>
            <Button label="Disconnect" kind="ghost" onPress={() => void disconnect(a)} />
          </View>
        ))}
      </Card>

      <T muted size={13} weight="600">OR USE A PERSONAL TOKEN (CLAUDE CODE, CURSOR, SCRIPTS)</T>

      <Card style={{ gap: space.md }}>
        <T weight="600">1. Create a token</T>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Name, e.g. Claude Code on laptop"
            placeholderTextColor={t.muted}
            style={{ flex: 1, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, minHeight: 44 }}
            accessibilityLabel="Token name"
          />
          <Button label="Create" onPress={create} loading={busy} style={{ minHeight: 44 }} />
        </View>
        {fresh && (
          <>
            <Banner text="Copy this token now. It won't be shown again." />
            <T selectable style={code}>{fresh}</T>
            <Button label="Copy token" kind="secondary" onPress={() => void shareOrCopy(fresh, 'Token copied')} />
          </>
        )}
      </Card>

      <Card style={{ gap: space.md }}>
        <T weight="600">2. Add it to your AI tool</T>
        <T muted size={14}>Claude Code (terminal):</T>
        <T selectable style={code}>{claudeCode}</T>
        <Button label="Copy command" kind="ghost" onPress={() => void shareOrCopy(claudeCode, 'Command copied')} />
        <T muted size={14}>Other MCP clients that accept a URL and headers (e.g. Cursor, Claude Desktop via a config file):</T>
        <T selectable style={code}>{json}</T>
        <Button label="Copy config" kind="ghost" onPress={() => void shareOrCopy(json, 'Config copied')} />
      </Card>

      {tokens.length > 0 && (
        <Card style={{ gap: space.sm }}>
          <T weight="600">Your tokens</T>
          {tokens.map((tok) => (
            <View key={tok.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs }}>
              <View style={{ flex: 1 }}>
                <T>{tok.name}</T>
                <T muted size={13}>
                  {tok.prefix}… · {tok.last_used_at ? `last used ${new Date(tok.last_used_at).toLocaleDateString()}` : 'never used'}
                </T>
              </View>
              <Button label="Revoke" kind="ghost" onPress={() => void revoke(tok)} />
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
