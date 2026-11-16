// Native agent entry point. Phase 1 (read-only plan-and-execute) + Phase 4 (approval
// gating for mutation tools, now resumable across multiple approvals).
//
//   POST /runs                        { objective, idempotency_key?, run_id? } -> run
//   GET  /runs/{id}                  -> persisted run + steps (RLS owner-only)
//   POST /runs/{id}/cancel           -> mark a non-terminal run cancelled
//   POST /runs/{id}/resume           -> continue from the persisted plan, skipping
//                                       decided actions (idempotent replay)
//   POST /approvals/{id}/approve     -> execute the bound tool (idempotent, single-use)
//   POST /approvals/{id}/reject      -> deny the bound tool
//
// Auth is the Supabase session. Reads and mutations go through the same uid-scoped
// Source the MCP server uses, so the agent can only touch what this user can. The LLM
// only ever proposes a plan; mutation tools run only after an explicit approval bound
// to the exact tool + args.
import {
  adminClient,
  llmStructured,
  corsHeaders,
  HttpError,
  json,
  requireUser,
} from '../_shared/services.ts';
import { makeSource } from '../_shared/mcp_source.ts';
import { sendFollowup, exportNotes } from '../_shared/agent_io.ts';
import { generatePresentation, generateDocument } from '../_shared/agent_docs.ts';
import { resolveTool, toolNames } from '../_shared/agent_registry.ts';
import { PLAN_TOOL, planMessages, planSystem, validatePlan } from '../_shared/agent_planner.ts';
import { newBudget } from '../_shared/agent_budgets.ts';
import { runAgent, type AgentDeps } from '../_shared/agent_orchestrator.ts';
import { policyFor } from '../_shared/agent_policies.ts';
import { actionKeyFor } from '../_shared/agent_approvals.ts';
import { remainingSteps } from '../_shared/agent_resume.ts';
import { allow } from '../_shared/agent_rate_limit.ts';
import { AgentError, toAgentError, UnknownToolError } from '../_shared/agent_errors.ts';
import type { PlanStep, StepOutcome } from '../_shared/agent_types.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPROVAL_TTL_MS = 60 * 60 * 1000; // an approval must be used within an hour
const RATE_WINDOW_MS = Number(Deno.env.get('AGENT_RATE_LIMIT_WINDOW_MS') ?? '3600000');
const RATE_MAX = Number(Deno.env.get('AGENT_RATE_LIMIT_MAX') ?? '30');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const path = new URL(req.url).pathname;
  try {
    const { id: userId, client } = await requireUser(req);

    if (req.method === 'POST' && /\/runs$/.test(path)) return await createRun(client, userId, await req.json());
    if (req.method === 'GET' && /\/runs\/[0-9a-fA-F-]{36}$/.test(path)) return await getRun(client, idFrom(path, /\/runs\/([0-9a-fA-F-]{36})/));
    if (req.method === 'POST' && /\/runs\/[0-9a-fA-F-]{36}\/cancel$/.test(path)) return await cancelRun(client, idFrom(path, /\/runs\/([0-9a-fA-F-]{36})/));
    if (req.method === 'POST' && /\/runs\/[0-9a-fA-F-]{36}\/resume$/.test(path)) return await resumeRun(client, userId, idFrom(path, /\/runs\/([0-9a-fA-F-]{36})/));
    if (req.method === 'POST' && /\/approvals\/[0-9a-fA-F-]{36}\/approve$/.test(path)) return await decideApproval(client, userId, idFrom(path, /\/approvals\/([0-9a-fA-F-]{36})/), 'approved');
    if (req.method === 'POST' && /\/approvals\/[0-9a-fA-F-]{36}\/reject$/.test(path)) return await decideApproval(client, userId, idFrom(path, /\/approvals\/([0-9a-fA-F-]{36})/), 'rejected');
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});

function idFrom(path: string, re: RegExp): string {
  const m = path.match(re);
  return m ? m[1] : '';
}

async function createRun(client: Supa, userId: string, body: { objective?: string; idempotency_key?: string; run_id?: string }) {
  const objective = String(body?.objective ?? '').trim();
  if (!objective) throw new HttpError(400, 'objective is required');
  if (objective.length > 2000) throw new HttpError(400, 'objective is too long');

  const key = String(body?.idempotency_key ?? '').trim() || null;
  const runId = String(body?.run_id ?? '').trim() || crypto.randomUUID();
  if (!UUID.test(runId)) throw new HttpError(400, 'run_id must be a uuid');

  const { data: existing } = key
    ? await client.from('agent_runs').select('id, status').eq('user_id', userId).eq('idempotency_key', key).maybeSingle()
    : { data: null };
  if (existing?.id) return json({ run_id: existing.id, status: existing.status, reused: true });

  const admin = adminClient();
  await enforceRateLimit(admin, userId);

  await client.from('agent_runs').insert({ id: runId, user_id: userId, intent: 'general', status: 'running', plan: [], idempotency_key: key });
  await client.from('agent_messages').insert({ run_id: runId, user_id: userId, role: 'user', content: objective });

  const source = await makeSource(admin, userId);
  const names = toolNames();
  const rawPlan = await llmStructured<{ steps?: unknown }>(
    planSystem(names),
    planMessages(objective),
    PLAN_TOOL as unknown as { name: string; input_schema: Record<string, unknown> },
  );
  const steps = validatePlan(rawPlan, newBudget().maxSteps);
  await client.from('agent_runs').update({ plan: steps }).eq('id', runId);

  return await executeSteps({ client, userId, runId, source, actions: buildActions(admin, client, userId), steps, key });
}

async function resumeRun(client: Supa, userId: string, runId: string) {
  const admin = adminClient();
  const { data: run } = await client.from('agent_runs').select('status, plan').eq('id', runId).maybeSingle();
  if (!run) throw new HttpError(404, 'Run not found');
  if (['completed', 'failed', 'cancelled'].includes(run.status)) throw new HttpError(409, 'This run is not resumable');
  const plan = Array.isArray(run.plan) ? (run.plan as PlanStep[]) : [];
  if (!plan.length) throw new HttpError(409, 'Nothing to resume');

  const { data: stepRows } = await admin.from('agent_steps').select('id').eq('run_id', runId);
  const stepIds = (stepRows ?? []).map((s: { id: string }) => s.id);
  const done = new Set<string>();
  const pending = new Set<string>();
  if (stepIds.length) {
    const { data: tcs } = await admin.from('agent_tool_calls').select('tool, args, status').in('step_id', stepIds);
    for (const tc of (tcs ?? []) as { tool: string; args: Record<string, unknown> | null; status: string }[]) {
      const k = actionKeyFor(tc.tool, (tc.args ?? {}) as Record<string, unknown>);
      if (tc.status === 'succeeded' || tc.status === 'denied') done.add(k);
      else if (tc.status === 'pending') pending.add(k);
    }
  }

  // An unanswered approval is returned as-is; never raise a duplicate.
  if (pending.size) {
    const { data: ap } = await client.from('agent_approvals').select('id, action_hash, expires_at, run_id, tool_call_id').eq('run_id', runId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (ap) return json({ run_id: runId, status: 'awaiting_approval', approvals: [{ id: ap.id, action_hash: ap.action_hash, expires_at: ap.expires_at }] });
  }

  const remaining = remainingSteps(plan, done, pending);
  const source = await makeSource(admin, userId);
  return await executeSteps({ client, userId, runId, source, actions: buildActions(admin, client, userId), steps: remaining, key: null });
}

// deno-lint-ignore no-explicit-any
async function enforceRateLimit(admin: Supa, userId: string) {
  const cutoff = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { data } = await admin.from('agent_runs').select('created_at').eq('user_id', userId).gte('created_at', cutoff).order('created_at', { ascending: true }).limit(RATE_MAX + 1);
  const events = ((data ?? []) as { created_at: string }[]).map((r) => Date.parse(r.created_at)).filter((n) => Number.isFinite(n));
  const decision = allow(events, Date.now(), { max: RATE_MAX, windowMs: RATE_WINDOW_MS });
  if (!decision.allowed) throw new HttpError(429, `Rate limit reached; retry in ${Math.ceil(decision.retryAfterMs / 1000)}s`);
}

// deno-lint-ignore no-explicit-any
function buildActions(admin: Supa, client: Supa, userId: string) {  return {
    sendFollowup: (input: { recording_id: string; to: string[] }) => sendFollowup(admin, userId, input),
    exportNotes: (rid: string, destination: 'slack' | 'notion' | 'onenote' | 'hubspot' | 'salesforce') => exportNotes(admin, userId, rid, destination),
    presentationsGenerate: (args: { recording_id?: string; project_id?: string; kind: string; audience?: string; detail?: 'concise' | 'detailed'; enhancements?: { images?: boolean; diagrams?: boolean; charts?: boolean; notes?: boolean } }) => generatePresentation(client, admin, userId, args),
    documentsGenerate: (recording_id: string) => generateDocument(admin, userId, recording_id),
  };
}

async function executeSteps(ctx: { client: Supa; userId: string; runId: string; source: Awaited<ReturnType<typeof makeSource>>; actions: ReturnType<typeof buildActions>; steps: PlanStep[]; key: string | null }) {
  const { client, userId, runId, source, actions, steps, key } = ctx;
  const outcomes: StepOutcome[] = [];
  const deps: AgentDeps = {
    steps,
    runTool: (tool: string, args: Record<string, unknown>) => {
      const def = resolveTool(tool);
      if (!def) throw new UnknownToolError(tool);
      return def.run(args, { userId, source, actions });
    },
    budget: newBudget(),
    onStep: (o) => void outcomes.push(o),
  };

  const summary = await runAgent('', deps);
  const stepRows = await persistSteps(client, runId, outcomes);

  if (summary.status === 'awaiting_approval') {
    const pending = outcomes.find((o) => o.status === 'awaiting_approval');
    const pendingRow = stepRows.find((s) => s.status === 'awaiting_approval');
    const approval = await createApproval(client, runId, userId, pendingRow!.stepId, pending!.tool, pending!.args ?? {}, key);
    await client.from('agent_runs').update({ status: 'awaiting_approval' }).eq('id', runId);
    return json({ run_id: runId, status: 'awaiting_approval', approvals: [approval], steps: outcomes.map(stepSummary) });
  }

  const status = summary.status === 'completed' ? 'completed' : 'failed';
  await client.from('agent_runs').update({ status }).eq('id', runId);
  return json({ run_id: runId, status, steps: outcomes.map(stepSummary) });
}

async function createApproval(client: Supa, runId: string, userId: string, stepId: string, tool: string, args: Record<string, unknown>, idempotencyKey: string | null) {
  const actionKey = actionKeyFor(tool, args);
  const { data: tc } = await client.from('agent_tool_calls').insert({ step_id: stepId, tool, args, args_sha256: actionKey, status: 'pending', idempotency_key: idempotencyKey }).select('id').single();
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
  const { data: ap } = await client.from('agent_approvals').insert({ run_id: runId, tool_call_id: tc.id, user_id: userId, action_hash: actionKey, status: 'pending', expires_at: expiresAt }).select('id').single();
  return { id: ap.id, tool, args, action_hash: actionKey, expires_at: expiresAt };
}

function stepSummary(o: StepOutcome) {
  return { step_index: o.stepIndex, tool: o.tool, status: o.status, error: o.error };
}

async function persistSteps(client: Supa, runId: string, outcomes: StepOutcome[]): Promise<{ stepId: string; tool: string; status: string }[]> {
  // step_index is a monotonic execution counter, not the plan position: a resumed run
  // appends more steps, and (run_id, step_index) is unique, so continue past the last.
  const { data: last } = await client.from('agent_steps').select('step_index').eq('run_id', runId).order('step_index', { ascending: false }).limit(1).maybeSingle();
  let next = ((last?.step_index as number | undefined) ?? -1) + 1;
  const rows: { stepId: string; tool: string; status: string }[] = [];
  for (const o of outcomes) {
    const stepId = crypto.randomUUID();
    const status = o.status === 'succeeded' ? 'succeeded' : o.status === 'awaiting_approval' ? 'awaiting_approval' : 'failed';
    await client.from('agent_steps').insert({ id: stepId, run_id: runId, step_index: next, tool: o.tool, status, output: o.result ?? null, error: o.error?.message ?? null });
    rows.push({ stepId, tool: o.tool, status });
    next++;
  }
  return rows;
}

async function decideApproval(client: Supa, userId: string, approvalId: string, decision: 'approved' | 'rejected') {
  const { data: ap } = await client.from('agent_approvals').select('id, run_id, tool_call_id, action_hash, status, expires_at, user_id').eq('id', approvalId).maybeSingle();
  if (!ap || ap.user_id !== userId) throw new HttpError(404, 'Approval not found');
  if (ap.status !== 'pending') throw new HttpError(409, 'This approval was already decided');
  if (new Date(ap.expires_at).getTime() <= Date.now()) {
    await client.from('agent_approvals').update({ status: 'expired' }).eq('id', approvalId);
    throw new HttpError(409, 'This approval expired');
  }

  if (decision === 'rejected') {
    await client.from('agent_approvals').update({ status: 'rejected', decided_at: new Date().toISOString() }).eq('id', approvalId);
    await client.from('agent_tool_calls').update({ status: 'denied' }).eq('id', ap.tool_call_id);
    await client.from('agent_runs').update({ status: 'cancelled' }).eq('id', ap.run_id);
    return json({ ok: true, status: 'rejected' });
  }

  const admin = adminClient();
  const { data: tc } = await admin.from('agent_tool_calls').select('tool, args, status').eq('id', ap.tool_call_id).maybeSingle();
  if (!tc || tc.status !== 'pending') throw new HttpError(409, 'Tool call is not pending');
  const tool = resolveTool(tc.tool);
  if (!tool) throw new HttpError(409, 'Tool is no longer registered');
  if (!policyFor(tool).requiresApproval) throw new HttpError(409, 'Tool does not require approval');
  if (actionKeyFor(tc.tool, (tc.args ?? {}) as Record<string, unknown>) !== ap.action_hash) throw new HttpError(409, 'Approval does not match the proposed action');

  const source = await makeSource(admin, userId);
  try {
    const result = await tool.run((tc.args ?? {}) as Record<string, unknown>, { userId, source, actions: buildActions(admin, client, userId) });
    await admin.from('agent_tool_calls').update({ status: 'succeeded', result }).eq('id', ap.tool_call_id);
    await admin.from('agent_approvals').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', approvalId);
    // The run may have more steps after this one; leave it runnable (resume continues).
    await admin.from('agent_runs').update({ status: 'awaiting_approval' }).eq('id', ap.run_id);
    return json({ ok: true, status: 'approved', result });
  } catch (e) {
    await ignoreWrite(() => admin.from('agent_tool_calls').update({ status: 'failed', result: null }).eq('id', ap.tool_call_id));
    await ignoreWrite(() => admin.from('agent_approvals').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', approvalId));
    await ignoreWrite(() => admin.from('agent_runs').update({ status: 'failed' }).eq('id', ap.run_id));
    return json({ ok: false, status: 'approved', error: (e as Error).message }, 400);
  }
}

// deno-lint-ignore no-explicit-any
async function ignoreWrite(fn: () => any) {
  try {
    await fn();
  } catch {
    // best-effort write in an error path; the primary error is what the caller sees
  }
}

async function getRun(client: Supa, runId: string) {
  const { data: run } = await client.from('agent_runs').select('id, intent, status, plan, created_at, updated_at').eq('id', runId).maybeSingle();
  if (!run) throw new HttpError(404, 'Run not found');
  const { data: steps } = await client.from('agent_steps').select('step_index, tool, status, output, error').eq('run_id', runId).order('step_index');
  return json({ ...run, steps: steps ?? [] });
}

async function cancelRun(client: Supa, runId: string) {
  const { data: run } = await client.from('agent_runs').select('id, status').eq('id', runId).maybeSingle();
  if (!run) throw new HttpError(404, 'Run not found');
  if (['completed', 'failed', 'cancelled'].includes(run.status)) return json({ run_id: runId, status: run.status, changed: false });
  await client.from('agent_runs').update({ status: 'cancelled' }).eq('id', runId);
  return json({ run_id: runId, status: 'cancelled', changed: true });
}
