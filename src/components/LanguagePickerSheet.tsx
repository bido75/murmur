// Searchable language picker: search by English name, native name or code;
// "Recently used" section; experimental languages labeled honestly. Works on
// web and native (AsyncStorage backs the recent-languages list).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { radius, space, useTheme } from "@/lib/theme";
import { findLanguage } from "@/lib/shared";
import {
  buildPickerSections,
  pushRecent,
  type PickerSection,
} from "@/lib/languagePicker";

const RECENT_KEY = "murmur.recentTranslateLanguages.v1";

async function loadRecent(): Promise<string[]> {
  try {
    const raw = await (await import("@react-native-async-storage/async-storage")).default.getItem(
      RECENT_KEY,
    );
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

async function saveRecent(codes: string[]) {
  try {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(codes));
  } catch {
    // A failed preference write must not break the translation itself.
  }
}

function labelFor(code: string): string {
  const entry = findLanguage(code);
  if (!entry) return code;
  return entry.translation === "llm-experimental"
    ? `${entry.name} (experimental)`
    : entry.name;
}

export function LanguagePickerSheet({
  visible,
  title,
  onClose,
  onPick,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  /** Called with the chosen BCP-47/ISO-639 code. */
  onPick: (code: string) => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (visible) {
      setQuery("");
      void loadRecent().then(setRecent);
    }
  }, [visible]);

  const sections: PickerSection[] = useMemo(
    () => buildPickerSections(query, recent),
    [query, recent],
  );

  const pick = useCallback(
    (code: string) => {
      setRecent((prev) => {
        const next = pushRecent(prev, code);
        void saveRecent(next);
        return next;
      });
      onClose();
      onPick(code);
    },
    [onClose, onPick],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close language picker">
        <Pressable style={[styles.sheet, { backgroundColor: t.surface }]} onPress={() => {}}>
          {title ? (
            <Text style={{ color: t.muted, fontSize: 13, padding: space.md, textAlign: "center" }}>
              {title}
            </Text>
          ) : null}
          <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm }}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search languages"
              placeholderTextColor={t.muted}
              accessibilityLabel="Search languages"
              autoCorrect={false}
              autoCapitalize="none"
              style={{
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: t.border,
                borderRadius: radius.md,
                color: t.ink,
                paddingHorizontal: space.md,
                paddingVertical: 10,
                fontSize: 15,
              }}
            />
          </View>
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            {sections.every((s) => s.entries.length === 0) && (
              <Text style={{ color: t.muted, textAlign: "center", padding: space.lg }}>
                No language matches that search.
              </Text>
            )}
            {sections.map((section) => (
              <View key={section.key}>
                {section.label ? (
                  <Text
                    style={{
                      color: t.muted,
                      fontSize: 12,
                      fontWeight: "600",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      paddingHorizontal: space.md,
                      paddingTop: space.md,
                      paddingBottom: 4,
                    }}
                  >
                    {section.label}
                  </Text>
                ) : null}
                {section.entries.map((l) => (
                  <Pressable
                    key={l.code}
                    accessibilityRole="button"
                    accessibilityLabel={`${labelFor(l.code)}${l.native ? `, ${l.native}` : ""}`}
                    onPress={() => pick(l.code)}
                    style={({ pressed }) => [
                      styles.item,
                      { backgroundColor: pressed ? t.bg : "transparent" },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.ink, fontSize: 16 }}>
                        {labelFor(l.code)}
                      </Text>
                      {l.native ? (
                        <Text style={{ color: t.muted, fontSize: 13 }}>{l.native}</Text>
                      ) : null}
                    </View>
                    <Text style={{ color: t.muted, fontSize: 13 }}>{l.code}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.item, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }]}
          >
            <Text style={{ color: t.muted, fontSize: 17, fontWeight: "600" }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  sheet: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "85%",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: space.xl,
    overflow: "hidden",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: space.md,
  },
});
