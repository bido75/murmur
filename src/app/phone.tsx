import * as ExpoLinking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, TextInput, View } from 'react-native';
import { ToggleRow } from '@/components/ToggleRow';
import { Banner, Button, Card, T } from '@/components/ui';
import { aircallConnect, aircallSetup, disconnectIntegration, getPhoneLink, listIntegrations, phoneInfo, removePhoneLink, ringcentralAvailable, setPhoneLink, startRingCentral } from '@/lib/api';
import { confirm, isWeb, notify, shareOrCopy } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';

export default function Phone() {
  const t = useTheme();
  const [info, setInfo] = useState<{ number: string | null; allowed: string[] } | null>(null);
  const [link, setLink] = useState<{ phone_e164: string; locked_until: string | null } | null>(null);
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  // Aircall
  const [aircall, setAircall] = useState<{ account?: string } | null>(null);
  const [hook, setHook] = useState<string | null>(null);
  const [apiId, setApiId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [whToken, setWhToken] = useState('');
  const [onlyMine, setOnlyMine] = useState(true);
  // RingCentral
  const [rcOk, setRcOk] = useState(false);
  const [rc, setRc] = useState<{ account?: string } | null>(null);
  const params = useLocalSearchParams<{ connected?: string }>();

  useEffect(() => {
    phoneInfo().then(setInfo);
    getPhoneLink().then(setLink);
    listIntegrations()
      .then((l) => {
        setAircall(l.find((i) => i.provider === 'aircall')?.config ?? null);
        setRc(l.find((i) => i.provider === 'ringcentral')?.config ?? null);
      })
      .catch(() => undefined);
    ringcentralAvailable().then(setRcOk);
  }, []);

  useEffect(() => {
    if (params.connected === 'ringcentral:ok') notify('RingCentral connected', 'Recorded calls on your extension will appear as recordings a minute or two after they end.');
    if (params.connected === 'ringcentral:failed') notify("Couldn't connect RingCentral", 'Please try again.');
  }, [params.connected]);

  async function connectRc() {
    try {
      const back = isWeb ? `${window.location.origin}/phone` : ExpoLinking.createURL('phone');
      const url = await startRingCentral(back);
      if (isWeb) window.location.assign(url);
      else await Linking.openURL(url);
    } catch (e) {
      notify("Couldn't start RingCentral sign-in", (e as Error).message);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const e164 = phone.trim().replace(/[\s().-]/g, '');
      await setPhoneLink(e164.startsWith('+') ? e164 : /^\d{10}$/.test(e164) ? `+1${e164}` : `+${e164}`, pin.trim());
      setPin('');
      setLink(await getPhoneLink());
    } catch (e) {
      notify("Couldn't save", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!(await confirm('Unlink this phone?', 'Calls from it to the Murmur number will no longer be recorded.', 'Unlink', true))) return;
    await removePhoneLink().catch((e) => notify("Couldn't unlink", (e as Error).message));
    setLink(null);
  }

  async function connectAircall() {
    setBusy(true);
    try {
      const r = await aircallConnect({ api_id: apiId.trim(), api_token: apiToken.trim(), webhook_token: whToken.trim(), only_mine: onlyMine });
      setAircall({ account: r.account });
      setApiId('');
      setApiToken('');
      setWhToken('');
    } catch (e) {
      notify("Couldn't connect Aircall", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.ink, borderRadius: radius.md, padding: space.md, fontSize: 16 } as const;
  const code = { fontFamily: 'Courier', fontSize: 13, color: t.ink, backgroundColor: t.bg, padding: space.md, borderRadius: radius.sm } as const;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card style={{ gap: space.md }}>
        <T weight="600">Record a phone call</T>
        {info && !info.number ? (
          <T muted size={14}>Phone-call recording isn’t set up on the server yet (see README: Twilio).</T>
        ) : (
          <>
            <T muted size={14}>
              Call your Murmur number from your linked phone, enter your PIN, then the number you want to reach. Both people hear that the call is
              recorded, then you get notes and tasks like any other recording.
            </T>
            {info?.number && (
              <>
                <T size={22} weight="700" selectable>{info.number}</T>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="Call now" onPress={() => void Linking.openURL(`tel:${info.number}`)} style={{ flex: 1 }} disabled={!link} />
                  <Button label="Copy" kind="ghost" onPress={() => void shareOrCopy(info.number!, 'Number copied')} style={{ flex: 1 }} />
                </View>
                <T muted size={13}>Tip: save it as a contact named “Murmur”. You can call {info.allowed.join(', ')} numbers.</T>
              </>
            )}
            {link ? (
              <>
                <T>Linked phone: <T weight="600">{link.phone_e164}</T></T>
                {link.locked_until && new Date(link.locked_until) > new Date() && <Banner text="Locked after too many wrong PINs. Try again in a few minutes." />}
                <Button label="Change PIN or number" kind="secondary" onPress={() => setLink(null)} />
                <Button label="Unlink" kind="ghost" onPress={unlink} />
              </>
            ) : (
              <>
                <T muted size={14}>Your mobile number and a PIN you’ll enter on each call (caller ID alone can be faked):</T>
                <TextInput value={phone} onChangeText={setPhone} placeholder="+1 512 555 0123" placeholderTextColor={t.muted} keyboardType="phone-pad" style={input} accessibilityLabel="Your phone number" />
                <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))} placeholder="PIN, 4 to 8 digits" placeholderTextColor={t.muted} keyboardType="number-pad" secureTextEntry style={input} accessibilityLabel="Call PIN" />
                <Button label="Save" onPress={save} loading={busy} disabled={phone.replace(/\D/g, '').length < 8 || pin.length < 4} />
              </>
            )}
          </>
        )}
      </Card>

      <Card style={{ gap: space.md }}>
        <T weight="600">Aircall</T>
        <T muted size={14}>Calls on your Aircall lines are imported automatically after they end (call recording must be on in Aircall).</T>
        {aircall ? (
          <>
            <T>Connected{aircall.account ? ` to ${aircall.account}` : ''}</T>
            <Button
              label="Disconnect"
              kind="ghost"
              onPress={() =>
                void confirm('Disconnect Aircall?', 'New calls stop being imported. Also delete the webhook in Aircall.', 'Disconnect', true).then(async (ok) => {
                  if (!ok) return;
                  await disconnectIntegration('aircall').catch((e) => notify("Couldn't disconnect", (e as Error).message));
                  setAircall(null);
                })
              }
            />
          </>
        ) : !hook ? (
          <Button label="Set up Aircall" kind="secondary" onPress={() => void aircallSetup().then(setHook).catch((e) => notify("Couldn't start", (e as Error).message))} />
        ) : (
          <>
            <T size={14}>1. In Aircall → Integrations → Webhook, add this URL with the event call.ended:</T>
            <T selectable style={code}>{hook}</T>
            <Button label="Copy URL" kind="ghost" onPress={() => void shareOrCopy(hook, 'URL copied')} />
            <T size={14}>2. Paste the webhook token Aircall shows, and an API ID and token (Integrations → API Keys):</T>
            <TextInput value={whToken} onChangeText={setWhToken} placeholder="Webhook token" placeholderTextColor={t.muted} autoCapitalize="none" style={input} accessibilityLabel="Aircall webhook token" />
            <TextInput value={apiId} onChangeText={setApiId} placeholder="API ID" placeholderTextColor={t.muted} autoCapitalize="none" style={input} accessibilityLabel="Aircall API ID" />
            <TextInput value={apiToken} onChangeText={setApiToken} placeholder="API token" placeholderTextColor={t.muted} autoCapitalize="none" secureTextEntry style={input} accessibilityLabel="Aircall API token" />
            <ToggleRow label="Only my calls" hint="Off imports every call on the account into your recordings" value={onlyMine} onChange={setOnlyMine} />
            <Button label="Connect" onPress={connectAircall} loading={busy} disabled={!whToken.trim() || !apiId.trim() || !apiToken.trim()} />
          </>
        )}
      </Card>

      {(rcOk || rc) && (
        <Card style={{ gap: space.md }}>
          <T weight="600">RingCentral</T>
          <T muted size={14}>Recorded calls on your RingCentral extension are imported automatically after they end (call recording must be on).</T>
          {rc ? (
            <>
              <T>Connected{rc.account ? ` as ${rc.account}` : ''}</T>
              <Button
                label="Disconnect"
                kind="ghost"
                onPress={() =>
                  void confirm('Disconnect RingCentral?', 'New calls stop being imported.', 'Disconnect', true).then(async (ok) => {
                    if (!ok) return;
                    await disconnectIntegration('ringcentral').catch((e) => notify("Couldn't disconnect", (e as Error).message));
                    setRc(null);
                  })
                }
              />
            </>
          ) : (
            <Button label="Connect with RingCentral" onPress={() => void connectRc()} />
          )}
        </Card>
      )}
    </ScrollView>
  );
}
