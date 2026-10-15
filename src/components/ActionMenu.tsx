import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import { radius, space, useTheme } from '@/lib/theme';

export type MenuAction = { label: string; onPress: () => void; destructive?: boolean };

/** A bottom sheet of actions that behaves the same on iOS, Android and web. */
export function ActionMenu({ visible, title, actions, onClose }: {
  visible: boolean;
  title?: string;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        <Pressable style={[styles.sheet, { backgroundColor: t.surface }]} onPress={() => {}}>
          {title ? <Text style={{ color: t.muted, fontSize: 13, padding: space.md, textAlign: 'center' }}>{title}</Text> : null}
          {actions.map((a) => (
            <Pressable
              key={a.label}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                a.onPress();
              }}
              style={({ pressed }) => [styles.item, { borderTopColor: t.border, backgroundColor: pressed ? t.bg : 'transparent' }]}
            >
              <Text style={{ color: a.destructive ? t.danger : t.ink, fontSize: 17 }}>{a.label}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.item, { borderTopColor: t.border }]}>
            <Text style={{ color: t.muted, fontSize: 17, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 520, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl, overflow: 'hidden' },
  item: { paddingVertical: 16, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
});
