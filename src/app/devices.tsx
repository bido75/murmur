import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, T } from '@/components/ui';
import { createDeviceCode, listDevices, unlinkDevice, type Device } from '@/lib/api';
import { confirm, notify } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';

const KIND: Record<Device['kind'], string> = { extension: 'Browser extension', watch: 'Apple Watch', wear: 'Wear OS watch', desktop: 'Desktop', other: 'Device' };

export default function Devices() {
  const t = useTheme();
  const [devices, setDevices] = useState<Device[]>([]);
  const [code, setCode] = useState<{ value: string; until: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => listDevices().then(setDevices).catch((e) => notify("Couldn't load devices", (e as Error).message)), []);
  useEffect(() => {
    listDevices()
      .then(setDevices)
      .catch((e) => notify("Couldn't load devices", (e as Error).message));
  }, []);

  async function makeCode() {
    setBusy(true);
    try {
      const c = await createDeviceCode();
      setCode({ value: `${c.slice(0, 4)}-${c.slice(4)}`, until: Date.now() + 10 * 60_000 });
    } catch (e) {
      notify("Couldn't make a code", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unlink(d: Device) {
    if (!(await confirm(`Unlink ${d.name}?`, 'It can no longer upload recordings until it is linked again.', 'Unlink', true))) return;
    await unlinkDevice(d.id).catch((e) => notify("Couldn't unlink", (e as Error).message));
    await load();
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <T muted>
        Record from the Murmur browser extension, an Apple Watch or a Wear OS watch. Linked devices can only upload recordings — they can’t read your
        notes.
      </T>
      <Card style={{ gap: space.md }}>
        <T weight="600">Link a device</T>
        <T muted size={14}>Open Murmur on the device, choose “Link”, and type this code. It works once, for 10 minutes.</T>
        {code ? (
          <>
            <View style={{ backgroundColor: t.bg, borderRadius: radius.md, padding: space.lg, alignItems: 'center' }}>
              <T size={34} weight="700" selectable style={{ letterSpacing: 4, fontFamily: 'Courier' }}>{code.value}</T>
            </View>
            <T muted size={13}>Expires at {new Date(code.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</T>
            <Button label="Done" kind="secondary" onPress={() => { setCode(null); void load(); }} />
          </>
        ) : (
          <Button label="Show a code" onPress={makeCode} loading={busy} />
        )}
      </Card>
      {devices.length > 0 && (
        <Card style={{ gap: space.sm }}>
          <T weight="600">Linked devices</T>
          {devices.map((d) => (
            <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: t.border }}>
              <View style={{ flex: 1 }}>
                <T>{d.name}</T>
                <T muted size={13}>{KIND[d.kind]} · {d.last_used_at ? `last upload ${new Date(d.last_used_at).toLocaleDateString()}` : 'not used yet'}</T>
              </View>
              <Button label="Unlink" kind="ghost" onPress={() => void unlink(d)} />
            </View>
          ))}
        </Card>
      )}
      <Card style={{ gap: space.sm }}>
        <T weight="600">Where to get them</T>
        <T muted size={14}>Browser extension (Chrome, Edge, Brave, Arc): records a tab’s audio with your microphone — handy for meetings in the browser without a bot.</T>
        <T muted size={14}>Apple Watch and Wear OS: tap to record on your wrist; it uploads over Wi-Fi or cellular when you stop.</T>
      </Card>
    </ScrollView>
  );
}
