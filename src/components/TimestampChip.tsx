import { Pressable, StyleSheet, Text, View } from 'react-native';
import { clock } from '@/lib/format';
import { radius, space, useTheme } from '@/lib/theme';

/** A small time chip. With onPress it jumps the player to that moment. */
export function TimestampChip({ ms, onPress, label }: { ms: number; onPress?: () => void; label?: string }) {
  const t = useTheme();
  const text = label ?? clock(ms);
  if (!onPress) {
    return (
      <View style={[styles.chip, { backgroundColor: t.accentSoft }]}>
        <Text style={{ color: t.accent, fontSize: 12, fontWeight: '600' }}>{text}</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Play from ${text}`}
      hitSlop={6}
      style={[styles.chip, { backgroundColor: t.accentSoft }]}
    >
      <Text style={{ color: t.accent, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, marginLeft: space.sm },
});
