// Site photos and the daily site log on a recording.
import { useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, T } from "@/components/ui";
import { TimestampChip } from "@/components/TimestampChip";
import { clock } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import type { Photo, SiteLog } from "@/lib/types";

export function PhotoStrip({
  photos,
  onOpen,
  size = 76,
}: {
  photos: Photo[];
  onOpen: (p: Photo) => void;
  size?: number;
}) {
  const t = useTheme();
  if (!photos.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm }}
    >
      {photos.map((p) => (
        <Pressable
          key={p.id}
          onPress={() => onOpen(p)}
          accessibilityRole="imagebutton"
          accessibilityLabel={
            p.caption ??
            `Photo${p.taken_ms != null ? ` at ${clock(p.taken_ms)}` : ""}`
          }
        >
          {p.url ? (
            <Image
              source={{ uri: p.url }}
              style={[
                styles.thumb,
                { width: size, height: size, borderColor: t.border },
              ]}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                styles.thumb,
                {
                  width: size,
                  height: size,
                  borderColor: t.border,
                  backgroundColor: t.border,
                },
              ]}
            />
          )}
          {p.taken_ms != null && (
            <View style={styles.timeTag}>
              <T size={11} weight="600" style={{ color: "#FFFFFF" }}>
                {clock(p.taken_ms)}
              </T>
            </View>
          )}
          {p.pending && (
            <View style={[styles.timeTag, { left: 4, right: undefined }]}>
              <T size={11} weight="600" style={{ color: "#FFFFFF" }}>
                Uploading
              </T>
            </View>
          )}
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function PhotoViewer({
  photo,
  onClose,
  onPlay,
  canEdit,
  onCaption,
  onDelete,
}: {
  photo: Photo | null;
  onClose: () => void;
  onPlay?: (ms: number) => void;
  canEdit: boolean;
  onCaption: (p: Photo, caption: string) => void;
  onDelete: (p: Photo) => void;
}) {
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const caption =
    draft && photo && draft.id === photo.id
      ? draft.text
      : (photo?.caption ?? "");
  return (
    <Modal
      visible={!!photo}
      animationType="fade"
      onRequestClose={onClose}
      transparent={false}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        {photo && (
          <View style={{ flex: 1 }}>
            <Pressable
              style={{ flex: 1 }}
              onPress={onClose}
              accessibilityLabel="Close photo"
            >
              {photo.url ? (
                <Image
                  source={{ uri: photo.url }}
                  style={{ flex: 1 }}
                  resizeMode="contain"
                  accessibilityLabel={photo.caption ?? "Site photo"}
                />
              ) : null}
            </Pressable>
            <View style={{ padding: space.lg, gap: space.md }}>
              {canEdit && !photo.pending ? (
                <TextInput
                  value={caption}
                  onChangeText={(text) => setDraft({ id: photo.id, text })}
                  onEndEditing={() =>
                    caption !== (photo.caption ?? "") &&
                    onCaption(photo, caption)
                  }
                  placeholder="Add a caption (what and where)"
                  placeholderTextColor="#999"
                  style={styles.caption}
                  accessibilityLabel="Photo caption"
                />
              ) : photo.caption ? (
                <T size={16} style={{ color: "#FFFFFF" }}>
                  {photo.caption}
                </T>
              ) : null}
              <View style={{ flexDirection: "row", gap: space.sm }}>
                {photo.taken_ms != null && onPlay && (
                  <Button
                    label={`Play from ${clock(photo.taken_ms)}`}
                    kind="secondary"
                    onPress={() => {
                      onPlay(Math.max(0, photo.taken_ms! - 10_000));
                      onClose();
                    }}
                    style={{ flex: 1 }}
                  />
                )}
                {canEdit && !photo.pending && (
                  <Button
                    label="Delete"
                    kind="danger"
                    onPress={() => onDelete(photo)}
                    style={{ flex: 1 }}
                  />
                )}
                <Button
                  label="Close"
                  kind="secondary"
                  onPress={onClose}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

type Entry = {
  key: string;
  text: string;
  detail?: string | null;
  quote: string;
  quote_ms: number | null;
  verified: boolean;
  photo_ids: string[];
};

export function SiteLogView({
  log,
  photos,
  playAt,
  onOpenPhoto,
}: {
  log: SiteLog;
  photos: Photo[];
  playAt: (ms: number) => void;
  onOpenPhoto: (p: Photo) => void;
}) {
  const t = useTheme();
  const byId = new Map(photos.map((p) => [p.id, p]));
  const safety = log.issues.filter((i) => i.category === "safety");
  const other = log.issues.filter((i) => i.category !== "safety");

  const proof = (x: {
    quote: string;
    quote_ms: number | null;
    verified: boolean;
    photo_ids?: string[];
  }) => ({
    quote: x.quote,
    quote_ms: x.quote_ms,
    verified: x.verified,
    photo_ids: x.photo_ids ?? [],
  });
  const sections: { title: string; tone?: "danger"; entries: Entry[] }[] = [
    {
      title: "Safety",
      tone: "danger",
      entries: safety.map((x, i) => ({
        key: `s${i}`,
        text: x.text,
        detail: x.location,
        ...proof(x),
      })),
    },
    {
      title: "Issues",
      entries: other.map((x, i) => ({
        key: `i${i}`,
        text: x.text,
        detail:
          [x.location, x.category === "other" ? null : x.category]
            .filter(Boolean)
            .join(" · ") || null,
        ...proof(x),
      })),
    },
    {
      title: "Work completed",
      entries: log.work_completed.map((x, i) => ({
        key: `w${i}`,
        text: x.text,
        detail: x.location,
        ...proof(x),
      })),
    },
    {
      title: "Manpower",
      entries: log.manpower.map((x, i) => ({
        key: `m${i}`,
        text:
          x.count != null
            ? `${x.company_or_trade} — ${x.count}`
            : x.company_or_trade,
        ...proof(x),
      })),
    },
    {
      title: "Inspections",
      entries: log.inspections.map((x, i) => ({
        key: `n${i}`,
        text: x.text,
        detail: x.result,
        ...proof(x),
      })),
    },
    {
      title: "Deliveries",
      entries: log.deliveries.map((x, i) => ({
        key: `d${i}`,
        text: x.text,
        ...proof(x),
      })),
    },
    {
      title: "Delays",
      entries: log.delays.map((x, i) => ({
        key: `y${i}`,
        text: x.text,
        ...proof(x),
      })),
    },
  ];

  return (
    <View style={{ gap: space.lg }}>
      {log.weather && (
        <T size={15}>
          <T size={15} weight="600">
            Weather:{" "}
          </T>
          {log.weather.text}
        </T>
      )}
      {sections
        .filter((sec) => sec.entries.length)
        .map((sec) => (
          <View key={sec.title} style={{ gap: space.sm }}>
            <T
              size={13}
              weight="700"
              style={{ color: sec.tone === "danger" ? t.danger : t.muted }}
            >
              {sec.title.toUpperCase()}
            </T>
            {sec.entries.map((e) => {
              const pics = e.photo_ids
                .map((id) => byId.get(id))
                .filter((p): p is Photo => !!p);
              // Only a quote found in the transcript gets a chip.
              const ms = e.verified ? e.quote_ms : null;
              return (
                <Card
                  key={e.key}
                  style={{
                    gap: 4,
                    opacity: e.verified ? 1 : 0.6,
                    ...(sec.tone === "danger"
                      ? { borderLeftWidth: 4, borderLeftColor: t.danger }
                      : {}),
                  }}
                >
                  <T weight="600">{e.text}</T>
                  {e.detail ? (
                    <T size={13} weight="600" style={{ color: t.accent }}>
                      {e.detail}
                    </T>
                  ) : null}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: space.xs,
                    }}
                  >
                    <Pressable
                      disabled={e.quote_ms == null}
                      onPress={() => e.quote_ms != null && playAt(e.quote_ms)}
                      style={{ flex: 1 }}
                    >
                      <T muted size={13} style={{ fontStyle: "italic" }}>
                        “{e.quote}”
                        {e.verified
                          ? ""
                          : "  (not found in transcript, left out of exports)"}
                      </T>
                    </Pressable>
                    {ms != null ? (
                      <TimestampChip ms={ms} onPress={() => playAt(ms)} />
                    ) : null}
                  </View>
                  {pics.length > 0 && (
                    <PhotoStrip photos={pics} onOpen={onOpenPhoto} size={64} />
                  )}
                </Card>
              );
            })}
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  timeTag: {
    position: "absolute",
    right: 4,
    bottom: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  caption: {
    color: "#FFFFFF",
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#555",
    paddingVertical: space.sm,
  },
});
