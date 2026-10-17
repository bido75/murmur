import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { ToggleRow } from '@/components/ToggleRow';
import { Button, Card, T } from '@/components/ui';
import { addWebhook, apiBaseUrl, deleteWebhook, listWebhooks, setWebhookActive, type Webhook, type WebhookEvent } from '@/lib/api';
import { confirm, notify, shareOrCopy } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';

const EVENTS: { key: WebhookEvent; label: string }[] = [
  { key: 'recording.ready', label: 'Notes ready' },
  { key: 'recording.failed', label: 'Processing failed' },
  { key: 'task.created', label: 'New task found' },
];

const VERIFY = `// Node: verify the X-Murmur-Signature header
const [t, v1] = header.split(',').map((p) => p.split('=')[1]);
const mac = crypto.createHmac('sha256', SECRET).update(\`\${t}.\${rawBody}\`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(v1)) && Date.now() / 1000 - Number(t) < 300;`;

export default function Developers() {
  const t = useTheme();
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['recording.ready']);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => listWebhooks().then(setHooks).catch((e) => notify("Couldn't load webhooks", (e as Error).message)), []);
  useEffect(() => {
    listWebhooks()
      .then(setHooks)
      .catch((e) => notify("Couldn't load webhooks", (e as Error).message));
  }, []);

  async function add() {
    setBusy(true);
    try {
      await addWebhook(url, events, null);
      setUrl('');
      await load();
    } catch (e) {
      notify("Couldn't add webhook", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(h: Webhook) {
    if (!(await confirm('Delete this webhook?', h.url, 'Delete', true))) return;
    await deleteWebhook(h.id).catch((e) => notify("Couldn't delete", (e as Error).message));
    await load();
  }

  const base = apiBaseUrl();
  const curl = `curl -H "Authorization: Bearer <YOUR_TOKEN>" "${base}/recordings?limit=10"`;
  const input = { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 } as const;
  const code = { fontFamily: 'Courier', fontSize: 13, color: t.ink, backgroundColor: t.bg, padding: space.md, borderRadius: radius.sm } as const;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card style={{ gap: space.md }}>
        <T weight="600">Webhooks</T>
        <T muted size={14}>Murmur sends a signed POST with the notes, tasks and a link whenever one of these happens to your recordings.</T>
        {hooks.map((h) => (
          <View key={h.id} style={{ gap: space.xs, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: t.border }}>
            <T selectable numberOfLines={1}>{h.url}</T>
            <T muted size={13}>
              {h.events.map((e) => EVENTS.find((x) => x.key === e)?.label ?? e).join(', ')}
              {h.last_delivery_at ? ` · last sent ${new Date(h.last_delivery_at).toLocaleString()} (${h.last_status ?? 'error'})` : ' · not sent yet'}
            </T>
            {h.last_error ? <T size={13} style={{ color: t.danger }}>{h.last_error}</T> : null}
            <ToggleRow label="On" value={h.active} onChange={(v) => void setWebhookActive(h.id, v).then(load).catch((e) => notify("Couldn't save", (e as Error).message))} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label={shown === h.id ? 'Copy secret' : 'Show secret'} kind="secondary" onPress={() => (shown === h.id ? void shareOrCopy(h.secret, 'Secret copied') : setShown(h.id))} style={{ flex: 1 }} />
              <Button label="Delete" kind="ghost" onPress={() => void remove(h)} style={{ flex: 1 }} />
            </View>
            {shown === h.id && <T selectable style={code}>{h.secret}</T>}
          </View>
        ))}
        <TextInput value={url} onChangeText={setUrl} placeholder="https://your-server.com/murmur" placeholderTextColor={t.muted} autoCapitalize="none" keyboardType="url" style={input} accessibilityLabel="Webhook URL" />
        {EVENTS.map((e) => (
          <ToggleRow key={e.key} label={e.label} value={events.includes(e.key)} onChange={(on) => setEvents(on ? [...events, e.key] : events.filter((x) => x !== e.key))} />
        ))}
        <Button label="Add webhook" onPress={add} loading={busy} disabled={!/^https:\/\/\S+/.test(url.trim()) || !events.length} />
        <T muted size={13}>Each delivery has an X-Murmur-Signature header: t=timestamp,v1=HMAC-SHA256 of “timestamp.body” with the secret.</T>
        <T selectable style={code}>{VERIFY}</T>
      </Card>

      <Card style={{ gap: space.md }}>
        <T weight="600">REST API</T>
        <T muted size={14}>Read your recordings, notes, transcripts and tasks, and tick tasks off. Use a personal token from “Claude, ChatGPT and other AI tools”.</T>
        <T selectable style={code}>{`GET   /projects
GET   /recordings?project_id=&since=&before=&limit=
GET   /recordings/{id}            notes
GET   /recordings/{id}/transcript?offset=
GET   /search?q=
GET   /tasks?status=open|review|done&project_id=
PATCH /tasks/{id}  {"status":"done"}
POST  /webhooks   {"url":"https://…","events":["recording.ready"]}
DELETE /webhooks/{id}`}</T>
        <T muted size={14}>Base URL:</T>
        <T selectable style={code}>{base}</T>
        <T selectable style={code}>{curl}</T>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Copy example" kind="ghost" onPress={() => void shareOrCopy(curl, 'Copied')} style={{ flex: 1 }} />
          <Button label="Get a token" kind="secondary" onPress={() => router.push('/api-access')} style={{ flex: 1 }} />
        </View>
      </Card>
    </ScrollView>
  );
}
