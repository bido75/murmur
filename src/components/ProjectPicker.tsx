import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { T } from '@/components/ui';
import { createProject, listProjects } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { radius, space, useTheme } from '@/lib/theme';
import type { Project } from '@/lib/types';

/** Chips to choose a project (or none), with inline "New project". */
export function ProjectPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const t = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function add() {
    if (!name.trim()) return setAdding(false);
    try {
      const p = await createProject(name);
      setProjects((ps) => [p, ...ps]);
      onChange(p.id);
    } catch (e) {
      notify("Couldn't create project", (e as Error).message);
    } finally {
      setName('');
      setAdding(false);
    }
  }

  const chip = (key: string, label: string, on: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }}
    >
      <T size={15} weight={on ? '600' : '400'} style={{ color: on ? t.accent : t.ink }}>{label}</T>
    </Pressable>
  );

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {chip('none', 'No project', value === null, () => onChange(null))}
      {projects.map((p) => chip(p.id, p.name, value === p.id, () => onChange(p.id)))}
      {adding ? (
        <TextInput
          autoFocus
          value={name}
          onChangeText={setName}
          onSubmitEditing={add}
          onBlur={add}
          placeholder="Project name"
          placeholderTextColor={t.muted}
          style={{ minWidth: 160, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: t.accent, color: t.ink, fontSize: 15 }}
          accessibilityLabel="New project name"
        />
      ) : (
        chip('add', '+ New project', false, () => setAdding(true))
      )}
    </View>
  );
}
