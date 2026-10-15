import { Pressable, StyleSheet, Text, View } from 'react-native';
import { clock } from '@/lib/format';
import { radius, space, useTheme } from '@/lib/theme';
import type { Task } from '@/lib/types';

type Props = {
  task: Task;
  source?: string | null;
  onToggle: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  onQuotePress?: () => void;
};

export function TaskRow({ task, source, onToggle, onAccept, onDismiss, onQuotePress }: Props) {
  const t = useTheme();
  const done = task.status === 'done';
  const review = task.needs_review && task.status === 'open';
  const reason = !task.verified
    ? "Couldn't find this in the transcript"
    : task.kind === 'suggestion'
      ? 'Only suggested, not agreed'
      : 'Owner unclear';

  return (
    <View style={[styles.row, { borderColor: t.border }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`Mark "${task.text}" ${done ? 'not done' : 'done'}`}
        onPress={onToggle}
        hitSlop={10}
        style={[styles.check, { borderColor: done ? t.accent : t.muted, backgroundColor: done ? t.accent : 'transparent' }]}
      >
        {done && <Text style={styles.tick}>✓</Text>}
      </Pressable>

      <View style={{ flex: 1, gap: 6 }}>
        <Text style={{ color: done ? t.muted : t.ink, fontSize: 16, lineHeight: 22, textDecorationLine: done ? 'line-through' : 'none' }}>
          {task.text}
        </Text>

        <View style={styles.meta}>
          {task.owner && <Chip label={task.owner} />}
          {task.due_text && <Chip label={`Due ${task.due_text}`} />}
          {source && <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{source}</Text>}
        </View>

        {task.quote ? (
          <Pressable onPress={onQuotePress} disabled={!onQuotePress} accessibilityRole={onQuotePress ? 'button' : undefined}>
            <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19, fontStyle: 'italic' }}>
              “{task.quote}”{task.quote_ms != null ? `  ${clock(task.quote_ms)}` : ''}
            </Text>
          </Pressable>
        ) : null}

        {review && (
          <View style={[styles.review, { backgroundColor: t.warnSoft }]}>
            <Text style={{ color: t.warn, fontSize: 13, flex: 1 }}>{reason}</Text>
            <Pressable onPress={onAccept} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: t.accent, fontWeight: '700', fontSize: 13 }}>Keep</Text>
            </Pressable>
            <Pressable onPress={onDismiss} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: t.muted, fontWeight: '700', fontSize: 13 }}>Dismiss</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: t.accentSoft }]}>
      <Text style={{ color: t.accent, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  tick: { color: '#fff', fontSize: 14, fontWeight: '800' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  review: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.sm },
});
