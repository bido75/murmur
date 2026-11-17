import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Button, Card, T } from "@/components/ui";
import {
  decideAgentApproval,
  resumeAgentRun,
  runAgent,
  type AgentRunResult,
  type AgentStep,
} from "@/lib/api";
import { notify } from "@/lib/dialog";
import { radius, space, useTheme } from "@/lib/theme";

const TOOL_LABELS: Record<string, string> = {
  "tasks.create": "Create a task",
  "tasks.update": "Mark a task done or open",
  "followups.send": "Email the meeting recap",
  "integrations.export": "Export notes",
  "presentations.generate": "Build a presentation",
  "documents.generate": "Generate a document",
};

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

/** A compact, human-readable summary of the arguments an action will run with. */
function toolArgs(args: Record<string, unknown>): string {
  const bits: string[] = [];
  if (typeof args.text === "string" && args.text) bits.push(`“${args.text}”`);
  if (typeof args.owner === "string" && args.owner) bits.push(`owner ${args.owner}`);
  if (typeof args.due_text === "string" && args.due_text) bits.push(`due ${args.due_text}`);
  if (typeof args.destination === "string" && args.destination) bits.push(`to ${args.destination}`);
  if (Array.isArray(args.to) && args.to.length) bits.push(`to ${args.to.join(", ")}`);
  if (typeof args.kind === "string" && args.kind) bits.push(args.kind);
  if (typeof args.recording_id === "string") bits.push("one recording");
  if (!bits.length) return "no arguments";
  return bits.join(" · ");
}

const EXAMPLES = [
  "What decisions did we make across my last few meetings?",
  "Find my open tasks and tell me what's blocking.",
  "Draft a follow-up from yesterday's meeting (don't send it yet).",
];

function StepRow({ step }: { step: AgentStep }) {
  const t = useTheme();
  const mark = step.status === "succeeded" ? "✓" : step.status === "failed" ? "!" : "…";
  const color = step.status === "failed" ? t.danger : step.status === "succeeded" ? t.accent : t.muted;
  return (
    <T size={14} style={{ color }}>
      {mark} {toolLabel(step.tool)}
      {step.error ? <T muted size={12}> — {step.error.message}</T> : null}
    </T>
  );
}

export default function Assistant() {
  const t = useTheme();
  const [objective, setObjective] = useState("");
  const [run, setRun] = useState<AgentRunResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const q = objective.trim();
    if (!q) return;
    setBusy(true);
    try {
      setRun(await runAgent(q));
      setObjective("");
    } catch (e) {
      notify("Ask Murmur failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, decision: "approved" | "rejected") {
    if (!run) return;
    const runId = run.run_id;
    setBusy(true);
    try {
      const res = await decideAgentApproval(id, decision);
      if (decision === "rejected") {
        setRun({ ...run, status: "cancelled", approvals: [] });
        return;
      }
      if (res.completed) {
        setRun({ ...run, status: "completed", approvals: [] });
      } else {
        setRun(await resumeAgentRun(runId));
      }
    } catch (e) {
      notify("Couldn't apply your answer", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const approvals = run?.approvals ?? [];
  const showApprovals = run?.status === "awaiting_approval" && approvals.length > 0;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      <T muted>
        Ask Murmur to research across your meetings, then approve the actions it
        proposes. Nothing is sent or changed until you approve it.
      </T>

      <TextInput
        value={objective}
        onChangeText={setObjective}
        placeholder="What do you want to do?"
        placeholderTextColor={t.muted}
        autoCorrect={false}
        multiline
        style={{
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.surface,
          color: t.ink,
          borderRadius: radius.md,
          padding: space.md,
          fontSize: 16,
          minHeight: 72,
          textAlignVertical: "top",
        }}
        accessibilityLabel="Objective"
      />
      <Button label={busy ? "Working…" : "Ask Murmur"} onPress={submit} loading={busy} disabled={!objective.trim()} />

      {!run && (
        <View style={{ gap: space.sm }}>
          <T muted size={12} weight="600">
            TRY
          </T>
          {EXAMPLES.map((e) => (
            <Pressable key={e} onPress={() => setObjective(e)}>
              <T size={14} style={{ color: t.accent }}>
                “{e}”
              </T>
            </Pressable>
          ))}
        </View>
      )}

      {run && (
        <Card style={{ gap: space.sm }}>
          <T muted size={12} weight="600">
            {run.status === "awaiting_approval"
              ? "NEEDS YOUR APPROVAL"
              : run.status === "completed"
                ? "DONE"
                : run.status === "cancelled"
                  ? "STOPPED"
                  : run.status === "failed"
                    ? "FAILED"
                    : "WORKING"}
          </T>
          {run.steps.length > 0 && (
            <View style={{ gap: 4 }}>
              {run.steps.map((s) => (
                <StepRow key={s.step_index} step={s} />
              ))}
            </View>
          )}
        </Card>
      )}

      {showApprovals &&
        approvals.map((a) => (
          <Card key={a.id} style={{ gap: space.sm, borderColor: t.accent }}>
            <T weight="600">{toolLabel(a.tool)}</T>
            <T muted size={13}>{toolArgs(a.args)}</T>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button label="Approve" onPress={() => decide(a.id, "approved")} loading={busy} style={{ flex: 1 }} />
              <Button label="Reject" kind="secondary" onPress={() => decide(a.id, "rejected")} disabled={busy} style={{ flex: 1 }} />
            </View>
          </Card>
        ))}
    </ScrollView>
  );
}
