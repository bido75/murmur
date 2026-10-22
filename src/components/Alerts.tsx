// Messages and questions the app asks, without the browser's own dialogs.
//
// A browser's window.alert and window.confirm freeze the whole page while they are open.
// That is not fine while a recording is running: the screen stops redrawing, the buttons
// stop answering and the audio carries on. It is also not fine at start-up, when the app
// may need to say "your recording was recovered" before anything else is on screen. So on
// the web the app asks in its own window instead.
//
// The questions live in a small store outside React, so one asked before the host is
// ready is still shown as soon as it is. The host is mounted once, in the root layout.
import { useEffect, useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { radius, space, useTheme } from '@/lib/theme';

type Question = { title: string; message: string; okLabel: string; destructive: boolean; resolve: (ok: boolean) => void };
type Notice = { id: number; title: string; message?: string };
type Store = { question: Question | null; notices: Notice[] };

let store: Store = { question: null, notices: [] };
const listeners = new Set<() => void>();

function publish(next: Store) {
  store = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => store;

/** Ask a question in the app's own window. */
export function askInApp(title: string, message: string, okLabel: string, destructive: boolean): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    publish({ ...store, question: { title, message, okLabel, destructive, resolve } });
  });
}

/** Say something in the app's own window, without stopping the page. */
export function tellInApp(title: string, message?: string): void {
  const notice: Notice = { id: Date.now() + Math.random(), title, message };
  publish({ ...store, notices: [...store.notices.slice(-2), notice] });
}

/** The host for the app's own questions and notices. Mount it once, near the top. */
export function Alerts() {
  const t = useTheme();
  const { question, notices } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // A notice goes away by itself; it must never wait for a tap.
  useEffect(() => {
    if (!notices.length) return;
    const id = notices[0].id;
    const timer = setTimeout(() => {
      publish({ ...store, notices: store.notices.filter((n) => n.id !== id) });
    }, 4500);
    return () => clearTimeout(timer);
  }, [notices]);

  const answer = (ok: boolean) => {
    const q = store.question;
    if (!q) return;
    publish({ ...store, question: null });
    q.resolve(ok);
  };

  return (
    <>
      {notices.map((n) => (
        <View key={n.id} style={[styles.notice, { backgroundColor: t.ink }]} accessibilityRole="alert">
          <Text style={{ color: t.bg, fontSize: 15, fontWeight: '600' }}>{n.title}</Text>
          {n.message ? <Text style={{ color: t.bg, fontSize: 13, marginTop: 2, opacity: 0.9 }}>{n.message}</Text> : null}
        </View>
      ))}
      <Modal visible={!!question} transparent animationType="fade" onRequestClose={() => answer(false)}>
        <Pressable style={styles.backdrop} onPress={() => answer(false)} accessibilityLabel="Close">
          <Pressable style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]} onPress={() => {}}>
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: '700' }}>{question?.title}</Text>
            {question?.message ? <Text style={{ color: t.muted, fontSize: 14, marginTop: space.sm, lineHeight: 20 }}>{question.message}</Text> : null}
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
              <Button label="Cancel" kind="secondary" onPress={() => answer(false)} style={{ flex: 1 }} />
              <Button
                label={question?.okLabel ?? 'OK'}
                kind={question?.destructive ? 'danger' : 'primary'}
                onPress={() => answer(true)}
                style={{ flex: 1 }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    top: space.xl,
    zIndex: 10,
    padding: space.md,
    borderRadius: radius.md,
    maxWidth: 520,
    alignSelf: 'center',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: { width: '100%', maxWidth: 460, borderRadius: radius.lg, borderWidth: 1, padding: space.lg },
});
