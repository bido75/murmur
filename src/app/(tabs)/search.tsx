import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Button, Card, T } from "@/components/ui";
import { ask, searchRecordings, searchTasks, type SearchHit } from "@/lib/api";
import { clock, shortDate } from "@/lib/format";
import { markFirstSearch } from "@/lib/onboardingStore";
import { useTourController } from "@/components/tour/TourProvider";
import { radius, space, useTheme } from "@/lib/theme";
import { TEMPLATE_LABELS, type Task } from "@/lib/types";

type TaskHit = Task & { recordings: { title: string } | null };

/** Search everything you can see (yours and your teams'), or ask a question across it. */
export default function Search() {
  const t = useTheme();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [tasks, setTasks] = useState<TaskHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState("");
  const [answer, setAnswer] = useState<{
    q: string;
    text: string;
    sources: { recording_id: string; title: string }[];
  } | null>(null);
  const [asking, setAsking] = useState(false);
  const seq = useRef(0);
  const { state, userId } = useTourController();

  // Search as you type (debounced); stale responses are ignored.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const [r, tk] = await Promise.all([
          searchRecordings(term),
          searchTasks(term),
        ]);
        if (n === seq.current) {
          setHits(r);
          setTasks(tk);
          setSearched(term);
          // A real search counts as "Search or ask" checklist activity.
          if (userId && state.firstSearchAt == null) void markFirstSearch(userId);
        }
      } catch {
        if (n === seq.current) {
          setHits([]);
          setTasks([]);
          setSearched(term);
        }
      } finally {
        if (n === seq.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, state.firstSearchAt, userId]);

  async function askAll() {
    const question = q.trim();
    if (!question) return;
    setAsking(true);
    try {
      const res = await ask(question);
      setAnswer({ q: question, text: res.answer, sources: res.sources });
      if (userId && state.firstSearchAt == null) void markFirstSearch(userId);
    } catch (e) {
      setAnswer({
        q: question,
        text: `Sorry, that didn't work: ${(e as Error).message}`,
        sources: [],
      });
    } finally {
      setAsking(false);
    }
  }

  const short = q.trim().length < 2;
  const shown = short
    ? { hits: [] as SearchHit[], tasks: [] as TaskHit[] }
    : { hits, tasks };

  return (
    <ScrollView
      contentContainerStyle={{
        padding: space.lg,
        gap: space.lg,
        paddingBottom: space.xxl,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search words, names, topics…"
        placeholderTextColor={t.muted}
        returnKeyType="search"
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.surface,
          color: t.ink,
          borderRadius: radius.md,
          padding: space.md,
          fontSize: 17,
        }}
        accessibilityLabel="Search recordings"
      />
      {!short && (
        <Button
          label={
            asking
              ? "Thinking…"
              : `Ask: “${q.trim().slice(0, 40)}${q.trim().length > 40 ? "…" : ""}”`
          }
          kind="secondary"
          onPress={askAll}
          loading={asking}
        />
      )}

      {answer && (
        <Card style={{ gap: space.sm, borderColor: t.accent }}>
          <T muted size={12} weight="600">
            ANSWER · {answer.q.toUpperCase().slice(0, 60)}
          </T>
          <T selectable>{answer.text}</T>
          {answer.sources.length > 0 && (
            <View style={{ gap: 4 }}>
              <T muted size={12} weight="600">
                FROM
              </T>
              {answer.sources.map((s) => (
                <Pressable
                  key={s.recording_id}
                  onPress={() =>
                    router.push({
                      pathname: "/recording/[id]",
                      params: { id: s.recording_id },
                    })
                  }
                >
                  <T size={14} style={{ color: t.accent }}>
                    {s.title} →
                  </T>
                </Pressable>
              ))}
            </View>
          )}
        </Card>
      )}

      {busy && <ActivityIndicator color={t.muted} />}

      {short && !answer && (
        <T muted>
          Searches titles, notes and transcripts of every recording you can see,
          including your teams’. Or type a question and tap Ask to get an answer
          with the recordings it came from.
        </T>
      )}

      {!short &&
        !busy &&
        searched === q.trim() &&
        shown.hits.length === 0 &&
        shown.tasks.length === 0 && (
          <T muted>
            Nothing matches “{searched}”. Try fewer or different words, or Ask.
          </T>
        )}

      {shown.hits.length > 0 && (
        <View style={{ gap: space.sm }}>
          <T muted size={13} weight="600">
            RECORDINGS ({shown.hits.length})
          </T>
          {shown.hits.map((h) => (
            <Pressable
              key={h.recording_id}
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/recording/[id]",
                  params:
                    h.at_ms != null
                      ? { id: h.recording_id, t: String(h.at_ms) }
                      : { id: h.recording_id },
                })
              }
            >
              <Card style={{ gap: 4 }}>
                <T weight="600" numberOfLines={2}>
                  {h.title}
                </T>
                <T muted size={12}>
                  {shortDate(h.created_at)} ·{" "}
                  {TEMPLATE_LABELS[h.template] ?? h.template} ·{" "}
                  {h.at_ms != null
                    ? `said at ${clock(h.at_ms)}`
                    : `matched in ${h.matched}`}
                </T>
                {h.snippet ? <Snippet text={h.snippet} /> : null}
              </Card>
            </Pressable>
          ))}
        </View>
      )}

      {shown.tasks.length > 0 && (
        <View style={{ gap: space.sm }}>
          <T muted size={13} weight="600">
            TASKS ({shown.tasks.length})
          </T>
          {shown.tasks.map((task) => (
            <Pressable
              key={task.id}
              accessibilityRole="button"
              disabled={!task.recording_id}
              onPress={() =>
                task.recording_id &&
                router.push({
                  pathname: "/recording/[id]",
                  params: { id: task.recording_id },
                })
              }
            >
              <Card style={{ gap: 2 }}>
                <T weight="600">
                  {task.status === "done" ? "✓ " : ""}
                  {task.text}
                </T>
                <T muted size={12}>
                  {[
                    task.owner,
                    task.due_text && `due ${task.due_text}`,
                    task.recordings?.title,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </T>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

/** Highlights the [[matched]] words the server marks in the snippet. */
function Snippet({ text }: { text: string }) {
  const t = useTheme();
  const parts = text.split(/(\[\[[^\]]*\]\])/g).filter(Boolean);
  return (
    <T size={14} muted>
      {"…"}
      {parts.map((p, i) =>
        p.startsWith("[[") ? (
          <T
            key={i}
            size={14}
            weight="700"
            style={{ color: t.ink, backgroundColor: t.accentSoft }}
          >
            {p.slice(2, -2)}
          </T>
        ) : (
          <T key={i} size={14} muted>
            {p}
          </T>
        ),
      )}
      {"…"}
    </T>
  );
}
