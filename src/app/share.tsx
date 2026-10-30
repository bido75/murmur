import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Switch, TextInput, View } from "react-native";
import { TourAnchor } from "@/components/tour/TourAnchor";
import { Button, Card, T } from "@/components/ui";
import {
  createShareLink,
  emailAvailable,
  exportDocx,
  getRecording,
  listShareLinks,
  revokeShareLink,
  saveDeck,
  sendRecap,
  shareUrl,
} from "@/lib/api";
import { APP_URL } from "@/lib/config";
import { confirm, isWeb, notify, shareOrCopy } from "@/lib/dialog";
import { sharePdf, shareText } from "@/lib/export";
import { clock, shortDate } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import type { ShareLink } from "@/lib/types";

type Data = Awaited<ReturnType<typeof getRecording>>;
const EXPIRY: { label: string; days: number | null }[] = [
  { label: "Never", days: null },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];

/** Share one recording: a read-only link, an email recap, or a file. */
export default function Share() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const [data, setData] = useState<Data | null>(null);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [withTranscript, setWithTranscript] = useState(false);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [canEmail, setCanEmail] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [docxTranscript, setDocxTranscript] = useState(false);
  const [withAudio, setWithAudio] = useState(false);
  const [withQuestions, setWithQuestions] = useState(false);
  const [password, setPassword] = useState("");
  const base = APP_URL || (isWeb ? window.location.origin : "");

  const load = useCallback(async () => {
    const d = await getRecording(id);
    setData(d);
    setLinks(await listShareLinks(id).catch(() => []));
  }, [id]);

  useEffect(() => {
    getRecording(id)
      .then(setData)
      .catch((e) => notify("Couldn't load", (e as Error).message));
    listShareLinks(id)
      .then(setLinks)
      .catch(() => setLinks([]));
    emailAvailable().then(setCanEmail);
  }, [id]);

  const rec = data?.recording;
  const ready = rec?.status === "ready";
  const live = links.filter(
    (l) =>
      !l.revoked_at && (!l.expires_at || new Date(l.expires_at) > new Date()),
  );
  const active = live.filter((l) => l.clip_start_ms == null);
  const clips = live.filter((l) => l.clip_start_ms != null);
  const input = {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
    color: t.ink,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: 16,
  } as const;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      notify("Something went wrong", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const makeLink = () =>
    run("link", async () => {
      if (!base)
        throw new Error(
          "Set EXPO_PUBLIC_APP_URL (your web app address) so links have somewhere to open.",
        );
      const token = await createShareLink(id, {
        include_transcript: withTranscript,
        valid_days: expiry,
        allow_audio: withAudio,
        allow_questions: withQuestions,
        password: password.trim() || undefined,
      });
      setPassword("");
      await load();
      await shareOrCopy(shareUrl(token, base), "Link copied");
    });

  const email = () =>
    run("email", async () => {
      const res = await sendRecap(id, to, note);
      setTo("");
      setNote("");
      await load();
      notify(
        "Recap sent",
        `Emailed to ${res.sent} ${res.sent === 1 ? "person" : "people"}. You got a copy too.`,
      );
    });

  const word = () =>
    run("docx", async () => {
      const res = await exportDocx(id, docxTranscript);
      await saveDeck(res.url, res.filename);
    });

  if (!data) return null;
  if (!rec)
    return (
      <T style={{ padding: space.lg }}>This recording hasn’t uploaded yet.</T>
    );

  return (
    <ScrollView
      contentContainerStyle={{
        padding: space.lg,
        gap: space.lg,
        paddingBottom: space.xxl,
      }}
    >
      <Stack.Screen options={{ title: "Share" }} />
      <T size={22} weight="700" numberOfLines={2}>
        {rec.title}
      </T>
      {!ready && <T muted>Sharing opens up once the notes are ready.</T>}

      <TourAnchor id="share-link-card">
      <Card style={{ gap: space.md }}>
        <T size={18} weight="700">
          Link
        </T>
        <T muted size={14}>
          Anyone with the link can read the notes (no sign-in). Tasks still
          waiting for review are left out, and decisions that don&rsquo;t match
          the transcript are dropped. Key points are shown as written; the ones
          we couldn&rsquo;t check against the transcript are marked on the page.
        </T>
        <Row
          label="Include the transcript"
          value={withTranscript}
          onChange={setWithTranscript}
        />
        <Row
          label="Let people play the audio"
          value={withAudio}
          onChange={setWithAudio}
        />
        <Row
          label="Let people ask questions about it"
          value={withQuestions}
          onChange={setWithQuestions}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password (optional, 6+ characters)"
          placeholderTextColor={t.muted}
          secureTextEntry
          autoCapitalize="none"
          style={input}
          accessibilityLabel="Link password"
        />
        <View
          style={{
            flexDirection: "row",
            gap: space.sm,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <T size={15}>Expires:</T>
          {EXPIRY.map((e) => (
            <Button
              key={e.label}
              label={e.label}
              kind={expiry === e.days ? "primary" : "secondary"}
              onPress={() => setExpiry(e.days)}
              style={{ minHeight: 36, paddingHorizontal: space.md }}
            />
          ))}
        </View>
        <Button
          label="Create link and copy"
          onPress={makeLink}
          loading={busy === "link"}
          disabled={!ready}
        />
        {active.map((l) => (
          <View
            key={l.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              borderTopWidth: 1,
              borderTopColor: t.border,
              paddingTop: space.sm,
            }}
          >
            <View style={{ flex: 1 }}>
              <T size={14} numberOfLines={1}>
                …/s/{l.token.slice(0, 8)}…
                {[
                  l.include_transcript && "transcript",
                  l.allow_audio && "audio",
                  l.allow_questions && "questions",
                  l.has_password && "password",
                ]
                  .filter(Boolean)
                  .map((x) => ` · ${x}`)
                  .join("")}
              </T>
              <T muted size={12}>
                Made {shortDate(l.created_at)} · {l.views} view
                {l.views === 1 ? "" : "s"}
                {l.expires_at ? ` · expires ${shortDate(l.expires_at)}` : ""}
              </T>
            </View>
            <Button
              label="Copy"
              kind="ghost"
              onPress={() =>
                void shareOrCopy(shareUrl(l.token, base), "Link copied")
              }
            />
            <Button
              label="Turn off"
              kind="ghost"
              onPress={async () => {
                if (
                  !(await confirm(
                    "Turn off this link?",
                    "People who open it will see that it was turned off.",
                    "Turn off",
                    true,
                  ))
                )
                  return;
                await revokeShareLink(l.id).catch((e) =>
                  notify("Couldn't turn it off", (e as Error).message),
                );
                await load();
              }}
            />
          </View>
        ))}
      </Card>
      </TourAnchor>

      {clips.length > 0 && (
        <Card style={{ gap: space.md }}>
          <T size={18} weight="700">
            Clips
          </T>
          {clips.map((l) => (
            <View
              key={l.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
              }}
            >
              <View style={{ flex: 1 }}>
                <T size={14} weight="600" numberOfLines={1}>
                  {l.title || "Clip"}
                </T>
                <T muted size={12}>
                  {clock(l.clip_start_ms!)}–{clock(l.clip_end_ms!)} · {l.views}{" "}
                  view{l.views === 1 ? "" : "s"}
                </T>
              </View>
              <Button
                label="Copy"
                kind="ghost"
                onPress={() =>
                  void shareOrCopy(shareUrl(l.token, base), "Clip link copied")
                }
              />
              <Button
                label="Turn off"
                kind="ghost"
                onPress={() => void revokeShareLink(l.id).then(load)}
              />
            </View>
          ))}
          <T muted size={12}>
            Make a clip from the transcript: press and hold a line.
          </T>
        </Card>
      )}

      <Card style={{ gap: space.md }}>
        <T size={18} weight="700">
          Email a recap
        </T>
        {canEmail ? (
          <>
            <T muted size={14}>
              Sends the summary, next steps and decisions, with a link to the
              full notes. Each person is BCC’d; replies come to you.
            </T>
            <TextInput
              value={to}
              onChangeText={setTo}
              placeholder="maya@client.com, sam@architect.co"
              placeholderTextColor={t.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              multiline
              style={input}
              accessibilityLabel="Recipients"
            />
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Add a note (optional)"
              placeholderTextColor={t.muted}
              multiline
              style={[input, { minHeight: 64 }]}
              accessibilityLabel="Note"
            />
            <Button
              label="Send recap"
              onPress={email}
              loading={busy === "email"}
              disabled={!ready || !to.trim()}
            />
          </>
        ) : (
          <T muted size={14}>
            Email isn’t set up on the server yet. The admin adds an email
            provider key (see README → Email recaps).
          </T>
        )}
      </Card>

      <Card style={{ gap: space.md }}>
        <T size={18} weight="700">
          Export
        </T>
        <Row
          label="Word file includes the transcript"
          value={docxTranscript}
          onChange={setDocxTranscript}
        />
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          <Button
            label="Word (.docx)"
            kind="secondary"
            onPress={word}
            loading={busy === "docx"}
            style={{ flex: 1, minWidth: 120 }}
          />
          <Button
            label="PDF"
            kind="secondary"
            onPress={() =>
              void run("pdf", () =>
                sharePdf(rec, data.summary, data.tasks, data.photos),
              )
            }
            style={{ flex: 1, minWidth: 90 }}
          />
          <Button
            label="Text"
            kind="secondary"
            onPress={() =>
              void run("text", () => shareText(rec, data.summary, data.tasks))
            }
            style={{ flex: 1, minWidth: 90 }}
          />
        </View>
      </Card>
    </ScrollView>
  );
}

function Row({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <T style={{ flex: 1 }}>{label}</T>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: t.accent, false: t.border }}
        accessibilityLabel={label}
      />
    </View>
  );
}
