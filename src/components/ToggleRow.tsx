import { Switch, View } from 'react-native';
import { T } from '@/components/ui';
import { space, useTheme } from '@/lib/theme';

export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T>{label}</T>
        {hint ? <T muted size={13}>{hint}</T> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.accent, false: t.border }} accessibilityLabel={label} />
    </View>
  );
}
