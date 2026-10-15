import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { ActionMenu } from '@/components/ActionMenu';
import { listIntegrations, pushTasks } from '@/lib/api';
import { confirm, notify } from '@/lib/dialog';
import { PROVIDER_LABELS, type Integration, type Provider, type Task } from '@/lib/types';

/** Sends confirmed, open tasks that haven't been sent yet. Asks which tracker if several are connected. */
export function SendToTracker({ tasks, onDone }: { tasks: Task[]; onDone: () => void }) {
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listIntegrations().then(setIntegrations).catch(() => setIntegrations([]));
  }, []);

  const ready = (integrations ?? []).filter((i) => i.config.target);
  const eligible = (p: Provider) => tasks.filter((t) => t.status === 'open' && !t.needs_review && !t.external?.[p]?.url);

  async function send(p: Provider) {
    const list = eligible(p);
    if (!list.length) {
      notify('Nothing to send', `All open, confirmed tasks are already in ${PROVIDER_LABELS[p]}. Tasks marked "To review" are not sent until you keep them.`);
      return;
    }
    const target = ready.find((i) => i.provider === p)?.config.target?.name ?? PROVIDER_LABELS[p];
    const ok = await confirm(`Send ${list.length} task${list.length > 1 ? 's' : ''}?`, `They'll be created in ${target}, each with the quote it came from.`, 'Send');
    if (!ok) return;
    setBusy(true);
    try {
      const results = await pushTasks(list.map((t) => t.id), p);
      const sent = results.filter((r) => r.ok && !r.skipped).length;
      const failed = results.filter((r) => !r.ok && r.error);
      notify(
        failed.length ? `${sent} sent, ${failed.length} failed` : `${sent} sent to ${PROVIDER_LABELS[p]}`,
        failed.length ? failed[0].error : undefined,
      );
      onDone();
    } catch (e) {
      notify("Couldn't send tasks", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (integrations === null) return null;
  if (!ready.length) {
    return <Button label="Connect Asana, Linear or Jira" kind="ghost" onPress={() => router.push('/integrations')} />;
  }
  const label = ready.length === 1 ? `Send to ${PROVIDER_LABELS[ready[0].provider]}` : 'Send to tracker';
  return (
    <>
      <Button label={label} kind="secondary" loading={busy} onPress={() => (ready.length === 1 ? void send(ready[0].provider) : setPicking(true))} />
      <ActionMenu
        visible={picking}
        title="Send open tasks to"
        onClose={() => setPicking(false)}
        actions={ready.map((i) => ({ label: `${PROVIDER_LABELS[i.provider]} · ${i.config.target?.name}`, onPress: () => void send(i.provider) }))}
      />
    </>
  );
}
