import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { radius, space, useTheme } from '@/lib/theme';
import { STATUS_LABELS, type RecordingStatus } from '@/lib/types';

export function T({ children, style, muted, size = 16, weight = '400', numberOfLines, selectable }: {
  children: ReactNode;
  style?: TextStyle;
  muted?: boolean;
  size?: number;
  weight?: TextStyle['fontWeight'];
  numberOfLines?: number;
  selectable?: boolean;
}) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} selectable={selectable} style={[{ color: muted ? t.muted : t.ink, fontSize: size, fontWeight: weight, lineHeight: size * 1.4 }, style]}>
      {children}
    </Text>
  );
}

export function Button({ label, onPress, kind = 'primary', loading, disabled, style }: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : kind === 'secondary' ? t.surface : 'transparent';
  const fg = kind === 'primary' || kind === 'danger' ? '#FFFFFF' : kind === 'ghost' ? t.accent : t.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? t.border : 'transparent', opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{label}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>{children}</View>;
}

export function StatusPill({ status }: { status: RecordingStatus }) {
  const t = useTheme();
  const busy = status !== 'ready' && status !== 'failed';
  const color = status === 'failed' ? t.danger : status === 'ready' ? t.accent : t.warn;
  return (
    <View style={[styles.pill, { backgroundColor: status === 'ready' ? t.accentSoft : status === 'failed' ? t.warnSoft : t.warnSoft }]}>
      {busy && <ActivityIndicator size="small" color={color} style={{ marginRight: 6, transform: [{ scale: 0.7 }] }} />}
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}

export function Segmented<K extends string>({ value, options, onChange }: {
  value: K;
  options: { key: K; label: string }[];
  onChange: (k: K) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: t.border }]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={[styles.segment, on && { backgroundColor: t.surface }]}
          >
            <Text style={{ color: on ? t.ink : t.muted, fontWeight: on ? '600' : '500', fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Banner({ text, tone = 'warn', action }: { text: string; tone?: 'warn' | 'info'; action?: { label: string; onPress: () => void } }) {
  const t = useTheme();
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: tone === 'warn' ? t.warnSoft : t.accentSoft }]}>
      <Text style={{ color: tone === 'warn' ? t.warn : t.accent, flex: 1, fontSize: 14, lineHeight: 20 }}>{text}</Text>
      {action && (
        <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={8}>
          <Text style={{ color: tone === 'warn' ? t.warn : t.accent, fontWeight: '700', marginLeft: space.md }}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={{ alignItems: 'center', padding: space.xxl, gap: space.sm }}>
      <T size={17} weight="600">{title}</T>
      {body ? <T muted style={{ textAlign: 'center' }}>{body}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, borderWidth: 1 },
  card: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  banner: { flexDirection: 'row', alignItems: 'center', padding: space.md, borderRadius: radius.md },
});
