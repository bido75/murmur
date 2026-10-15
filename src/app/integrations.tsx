import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, TextInput, View } from 'react-native';
import { ActionMenu } from '@/components/ActionMenu';
import { Button, Card, T } from '@/components/ui';
import { connectIntegration, disconnectIntegration, integrationTargets, listIntegrations, setIntegrationTarget } from '@/lib/api';
import { confirm, notify } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';
import { PROVIDER_LABELS, type Integration, type Provider } from '@/lib/types';

const HELP: Record<Provider, { where: string; url: string }> = {
  linear: { where: 'Linear → Settings → Security & access → Personal API keys', url: 'https://linear.app/settings/account/security' },
  asana: { where: 'Asana developer console → Personal access tokens', url: 'https://app.asana.com/0/my-apps' },
  jira: { where: 'Atlassian account → Security → API tokens', url: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
};

export default function Integrations() {
  const [items, setItems] = useState<Integration[]>([]);

  const load = useCallback(async () => {
    try {
      setItems(await listIntegrations());
    } catch (e) {
      notify("Couldn't load connections", (e as Error).message);
    }
  }, []);

  useEffect(() => {
    listIntegrations()
      .then(setItems)
      .catch((e) => notify("Couldn't load connections", (e as Error).message));
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <T muted>
        Send action items to the tracker your team already uses. Tokens are stored on the server and never shown again in the app. Only tasks you’ve
        confirmed are sent, each with the quote it came from.
      </T>
      {(['linear', 'asana', 'jira'] as Provider[]).map((p) => (
        <ProviderCard key={p} provider={p} integration={items.find((i) => i.provider === p)} onChange={load} />
      ))}
    </ScrollView>
  );
}

function ProviderCard({ provider, integration, onChange }: { provider: Provider; integration?: Integration; onChange: () => void }) {
  const t = useTheme();
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [site, setSite] = useState('');
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<{ id: string; name: string }[] | null>(null);

  const input = { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 } as const;

  async function connect() {
    setBusy(true);
    try {
      await connectIntegration(provider, token.trim(), provider === 'jira' ? { email: email.trim(), site: site.trim() } : {});
      setToken('');
      onChange();
      await pickTarget();
    } catch (e) {
      notify(`Couldn't connect ${PROVIDER_LABELS[provider]}`, (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pickTarget() {
    setBusy(true);
    try {
      const list = await integrationTargets(provider);
      if (!list.length) notify('Nothing to choose', `No ${provider === 'linear' ? 'teams' : 'projects'} were found for this account.`);
      else setTargets(list);
    } catch (e) {
      notify("Couldn't load destinations", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirm(`Disconnect ${PROVIDER_LABELS[provider]}?`, 'The saved token is deleted. Tasks already sent stay in your tracker.', 'Disconnect', true);
    if (!ok) return;
    await disconnectIntegration(provider).catch((e) => notify("Couldn't disconnect", (e as Error).message));
    onChange();
  }

  return (
    <Card style={{ gap: space.md }}>
      <T size={18} weight="700">{PROVIDER_LABELS[provider]}</T>
      {integration ? (
        <>
          <T muted size={14}>Connected as {integration.config.account ?? 'your account'}</T>
          <T size={15}>
            Tasks go to: <T size={15} weight="600">{integration.config.target?.name ?? 'not chosen yet'}</T>
          </T>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label={integration.config.target ? 'Change' : 'Choose destination'} kind="secondary" loading={busy} onPress={pickTarget} style={{ flex: 1 }} />
            <Button label="Disconnect" kind="ghost" onPress={disconnect} style={{ flex: 1 }} />
          </View>
        </>
      ) : (
        <>
          <T muted size={14}>Create a token in {HELP[provider].where}.</T>
          <Button label={`Open ${PROVIDER_LABELS[provider]} token page`} kind="ghost" onPress={() => void Linking.openURL(HELP[provider].url)} />
          {provider === 'jira' && (
            <>
              <TextInput value={site} onChangeText={setSite} placeholder="yourcompany.atlassian.net" placeholderTextColor={t.muted} autoCapitalize="none" style={input} accessibilityLabel="Jira site" />
              <TextInput value={email} onChangeText={setEmail} placeholder="Email for that Atlassian account" placeholderTextColor={t.muted} autoCapitalize="none" keyboardType="email-address" style={input} accessibilityLabel="Atlassian email" />
            </>
          )}
          <TextInput value={token} onChangeText={setToken} placeholder="Paste token" placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry style={input} accessibilityLabel={`${PROVIDER_LABELS[provider]} token`} />
          <Button
            label="Connect"
            onPress={connect}
            loading={busy}
            disabled={!token.trim() || (provider === 'jira' && (!email.includes('@') || !site.trim()))}
          />
        </>
      )}
      <ActionMenu
        visible={!!targets}
        title={provider === 'linear' ? 'Send tasks to which team?' : 'Send tasks to which project?'}
        onClose={() => setTargets(null)}
        actions={(targets ?? []).map((tg) => ({
          label: tg.name,
          onPress: () =>
            void setIntegrationTarget(provider, tg)
              .then(onChange)
              .catch((e) => notify("Couldn't save", (e as Error).message)),
        }))}
      />
    </Card>
  );
}
