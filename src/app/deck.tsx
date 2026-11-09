import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Banner, Button, Card, T } from "@/components/ui";
import { DECK_LABELS, makeDeck, saveDeck, type DeckDetail, type DeckEnhancements, type DeckKind, type DeckStyle } from "@/lib/api";
import { notify } from "@/lib/dialog";
import { radius, space, useTheme } from "@/lib/theme";

const HINTS: Record<DeckKind, string> = {
  client_update:
    "Where things stand, decisions, next steps and what you need from the client.",
  site_report:
    "Observations and issues by location, safety items, progress and required actions.",
  pitch:
    "Problem, approach, why it works and the ask, using only what was said.",
  proposal:
    "The need, proposed scope, timeline and responsibilities as discussed.",
};

const STYLES: { id: DeckStyle; label: string }[] = [
  { id: "corporate", label: "Professional / Corporate" },
  { id: "minimal", label: "Modern / Minimal" },
  { id: "creative", label: "Creative / Visual" },
  { id: "tech", label: "Technology / Futuristic" },
];

const DETAILS: { id: DeckDetail; label: string }[] = [
  { id: "concise", label: "Concise" },
  { id: "standard", label: "Standard" },
  { id: "detailed", label: "Detailed" },
];

const ENHANCEMENTS: { id: keyof DeckEnhancements; label: string }[] = [
  { id: "diagrams", label: "Diagrams & flows" },
  { id: "charts", label: "Charts (when data supports)" },
  { id: "images", label: "Relevant images" },
  { id: "notes", label: "Speaker notes" },
];

export default function Deck() {
  const t = useTheme();
  const { recordingId, projectId } = useLocalSearchParams<{
    recordingId?: string;
    projectId?: string;
  }>();
  const [kind, setKind] = useState<DeckKind>("client_update");
  const [style, setStyle] = useState<DeckStyle>("corporate");
  const [detail, setDetail] = useState<DeckDetail>("standard");
  const [enhancements, setEnhancements] = useState<DeckEnhancements>({
    diagrams: true,
    charts: true,
    images: false,
    notes: true,
  });
  const [audience, setAudience] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    url: string;
    filename: string;
    slides: number;
  } | null>(null);

  async function generate() {
    setBusy(true);
    setResult(null);
    try {
      setResult(
        await makeDeck({
          kind,
          recordingId,
          projectId,
          audience: audience.trim(),
          style,
          detail,
          enhancements,
        }),
      );
    } catch (e) {
      notify("Couldn't make the deck", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }}>
      <T muted>
        Builds a PowerPoint from{" "}
        {projectId ? "this project's recent recordings" : "this recording"}.
        Decisions and next steps are copied from your verified notes, not
        rewritten.
      </T>

      <View style={{ gap: space.sm }}>
        {(Object.keys(DECK_LABELS) as DeckKind[]).map((k) => {
          const on = k === kind;
          return (
            <Pressable
              key={k}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setKind(k)}
            >
              <Card
                style={{
                  borderColor: on ? t.accent : t.border,
                  borderWidth: on ? 2 : 1,
                  gap: 2,
                }}
              >
                <T weight="600" style={{ color: on ? t.accent : t.ink }}>
                  {DECK_LABELS[k]}
                </T>
                <T muted size={14}>
                  {HINTS[k]}
                </T>
              </Card>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: space.sm }}>
        <T muted size={13} weight="600">
          VISUAL STYLE
        </T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {STYLES.map((s) => {
            const on = s.id === style;
            return (
              <Pressable
                key={s.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setStyle(s.id)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: on ? t.accent : t.border,
                  backgroundColor: on ? t.accentSoft : "transparent",
                }}
              >
                <T size={14} style={{ color: on ? t.accent : t.ink }}>
                  {s.label}
                </T>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <T muted size={13} weight="600">
          DETAIL
        </T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {DETAILS.map((d) => {
            const on = d.id === detail;
            return (
              <Pressable
                key={d.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setDetail(d.id)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: on ? t.accent : t.border,
                  backgroundColor: on ? t.accentSoft : "transparent",
                }}
              >
                <T size={14} style={{ color: on ? t.accent : t.ink }}>
                  {d.label}
                </T>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <T muted size={13} weight="600">
          VISUAL ENHANCEMENTS
        </T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {ENHANCEMENTS.map((e) => {
            const on = enhancements[e.id];
            return (
              <Pressable
                key={e.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() =>
                  setEnhancements((cur) => ({ ...cur, [e.id]: !cur[e.id] }))
                }
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: on ? t.accent : t.border,
                  backgroundColor: on ? t.accentSoft : "transparent",
                }}
              >
                <T size={14} style={{ color: on ? t.accent : t.ink }}>
                  {on ? "✓ " : ""}
                  {e.label}
                </T>
              </Pressable>
            );
          })}
        </View>
        <T muted size={12}>
          Images require a configured image provider and are skipped if none is set.
        </T>
      </View>

      <View style={{ gap: space.sm }}>
        <T muted size={13} weight="600">
          WHO IS IT FOR? (OPTIONAL)
        </T>
        <TextInput
          value={audience}
          onChangeText={setAudience}
          placeholder="e.g. Hartwell Development's owner's rep"
          placeholderTextColor={t.muted}
          style={{
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.surface,
            color: t.ink,
            borderRadius: radius.md,
            padding: space.md,
            fontSize: 16,
          }}
          accessibilityLabel="Audience"
        />
      </View>

      <Button
        label={busy ? "Building your deck…" : "Make deck"}
        onPress={generate}
        loading={busy}
      />

      {result && (
        <View style={{ gap: space.md }}>
          <Banner
            tone="info"
            text={`${result.filename} is ready (${result.slides}+ slides). The link works for one hour.`}
          />
          <Button
            label="Download / share"
            onPress={() =>
              void saveDeck(result.url, result.filename).catch((e) =>
                notify("Couldn't save the deck", (e as Error).message),
              )
            }
          />
          <Button label="Done" kind="ghost" onPress={() => router.back()} />
        </View>
      )}
    </ScrollView>
  );
}
