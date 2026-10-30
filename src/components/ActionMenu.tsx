import { Modal, Pressable, StyleSheet, Text } from "react-native";
import { radius, space, useTheme } from "@/lib/theme";

export type MenuAction = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  /** Optional group name; consecutive actions sharing one get a section header. */
  section?: string;
};

/** A bottom sheet of actions that behaves the same on iOS, Android and web. */
export function ActionMenu({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const t = useTheme();
  // Insert a small section header wherever the group name changes, so long
  // menus read as Share & export / AI tools / ... instead of one wall of rows.
  const rows: ({ section: string } | { action: MenuAction })[] = [];
  let last: string | undefined;
  for (const a of actions) {
    if (a.section && a.section !== last) {
      rows.push({ section: a.section });
      last = a.section;
    } else if (!a.section) {
      last = undefined;
    }
    rows.push({ action: a });
  }
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityLabel="Close menu"
      >
        <Pressable
          style={[styles.sheet, { backgroundColor: t.surface }]}
          onPress={() => {}}
        >
          {title ? (
            <Text
              style={{
                color: t.muted,
                fontSize: 13,
                padding: space.md,
                textAlign: "center",
              }}
            >
              {title}
            </Text>
          ) : null}
          {rows.map((row, i) =>
            "section" in row ? (
              <Text
                key={`s-${row.section}-${i}`}
                style={{
                  color: t.muted,
                  fontSize: 12,
                  fontWeight: "600",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  paddingHorizontal: space.md,
                  paddingTop: space.md,
                  paddingBottom: 4,
                  borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: t.border,
                }}
              >
                {row.section}
              </Text>
            ) : (
              <Pressable
                key={row.action.label}
                accessibilityRole="button"
                onPress={() => {
                  onClose();
                  row.action.onPress();
                }}
                style={({ pressed }) => [
                  styles.item,
                  {
                    borderTopColor: t.border,
                    backgroundColor: pressed ? t.bg : "transparent",
                  },
                ]}
              >
                <Text
                  style={{
                    color: row.action.destructive ? t.danger : t.ink,
                    fontSize: 17,
                  }}
                >
                  {row.action.label}
                </Text>
              </Pressable>
            ),
          )}
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.item, { borderTopColor: t.border }]}
          >
            <Text style={{ color: t.muted, fontSize: 17, fontWeight: "600" }}>
              Cancel
            </Text>
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
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: space.xl,
    overflow: "hidden",
  },
  item: {
    paddingVertical: 16,
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
