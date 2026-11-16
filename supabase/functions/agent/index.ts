// Native agent entry point. Phase 1 (read-only plan-and-execute) + Phase 4 (approval
// gating for mutation tools).
//
//   POST /runs                        { objective, idempotency_key?, run_id? } -> run
//   GET  /runs/{id}                  -> persisted run + steps (RLS owner-only)
//   POST /runs/{id}/cancel           -> mark a non-terminal run cancelled
//   POST /runs/{id}/resume           -> 501 (sequential multi-approval is a later slice)
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
import { resolveTool, toolNames } from '../_shared/agent_registry.ts';
import { PLAN_TOOL, planMessages, planSystem } from '../_shared/agent_planner.ts';
import { newBudget } from '../_shared/agent_budgets.ts';
import { runAgent, type AgentDeps } from '../_shared/agent_orchestrator.ts';
import { policyFor } from '../_shared/agent_policies.ts';
import { actionKeyFor } from '../_shared/agent_approvals.ts';
import { AgentError, toAgentError, UnknownToolError } from '../_shared/agent_errors.ts';
import type { StepOutcome } from '../_shared/agent_types.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPROVAL_TTL_MS = 60 * 60 * 1000; // an approval must be used within an hour

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const path = new URL(req.url).pathname;
  try {
    const { id: userId, client } = await requireUser(req);

    if (req.method === 'POST' && /\/runs$/.test(path)) return await createRun(client, userId, await req.json());
    if (req.method === 'GET' && /\/runs\/[0-9a-fA-F-]{36}$/.test(path)) return await getRun(client, idFrom(path, /\/runs\/([0-9a-fA-F-]{36})/));
    if (req.method === 'POST' && /\/runs\/[0-9a-fA-F-]{36}\/cancel$/.test(path)) return await cancelRun(client, idFrom(path, /\/runs\/([0-9a-fA-F-]{36})/));
    if (req.method === 'POST' && /\/runs\/[0-9a-fA-F-]{36}\/resume$/.test(path)) return json({ error: 'resume is added with sequential multi-approval (later Phase 4 slice)' }, 501);
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

  await client.from('agent_runs').insert({ id: runId, user_id: userId, intent: 'general', status: 'running', plan: [], idempotency_key: key });
  await client.from('agent_messages').insert({ run_id: runId, user_id: userId, role: 'user', content: objective });

  const source = await makeSource(adminClient(), userId);
  const names = toolNames();

  const deps: AgentDeps = {
    plan: (objective: string) =>
      llmStructured<{ steps?: unknown }>(
        planSystem(names),
        planMessages(objective),
        PLAN_TOOL as unknown as { name: string; input_schema: Record<string, unknown> },
      ),
    runTool: (tool: string, args: Record<string, unknown>) => {
      const def = resolveTool(tool);
      if (!def) throw new UnknownToolError(tool);
      return def.run(args, { userId, source });
    },
    budget: newBudget(),
  };

  const outcomes: StepOutcome[] = [];
  deps.onStep = (o) => void outcomes.push(o);

  try {
    const summary = await runAgent(objective, deps);
    const stepRows = await persistSteps(client, runId, outcomes);

    if (summary.status === 'awaiting_approval') {
      const pending = outcomes.find((o) => o.status === 'awaiting_approval');
      const pendingRow = stepRows.find((s) => s.status === 'awaiting_approval');
      const actionKey = actionKeyFor(pending!.tool, pending!.args ?? {});
      const { data: tc } = await client
        .from('agent_tool_calls')
        .insert({ step_id: pendingRow!.stepId, tool: pending!.tool, args: pending!.args ?? {}, args_sha256: actionKey, status: 'pending', idempotency_key: key })
        .select('id')
        .single();
      const { data: ap } = await client
        .from('agent_approvals')
        .insert({ run_id: runId, tool_call_id: tc.id, user_id: userId, action_hash: actionKey, status: 'pending', expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString() })
        .select('id')
        .single();

      await client.from('agent_runs').update({ status: 'awaiting_approval' }).eq('id', runId);
      return json({
        run_id: runId,
        status: 'awaiting_approval',
        approvals: [{ id: ap.id, tool: pending!.tool, args: pending!.args ?? {}, action_hash: actionKey, expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString() }],
        steps: outcomes.map(stepSummary),
      });
    }

    await client.from('agent_runs').update({ status: summary.status === 'completed' ? 'completed' : 'failed' }).eq('id', runId);
    return json({ run_id: runId, status: summary.status === 'completed' ? 'completed' : 'failed', steps: outcomes.map(stepSummary) });
  } catch (e) {
    const err: AgentError = toAgentError(e);
    await client.from('agent_runs').update({ status: 'failed' }).eq('id', runId);
    return json({ run_id: runId, status: 'failed', error: { code: err.code, message: err.message } }, 400);
  }
}

function stepSummary(o: StepOutcome) {
  return { step_index: o.stepIndex, tool: o.tool, status: o.status, error: o.error };
}

async function persistSteps(client: Supa, runId: string, outcomes: StepOutcome[]): Promise<{ stepId: string; tool: string; status: string }[]> {
  const rows: { stepId: string; tool: string; status: string }[] = [];
  for (const [i, o] of outcomes.entries()) {
    const stepId = crypto.randomUUID();
    const status = o.status === 'succeeded' ? 'succeeded' : o.status === 'awaiting_approval' ? 'awaiting_approval' : 'failed';
    await client.from('agent_steps').insert({ id: stepId, run_id: runId, step_index: i, tool: o.tool, status, output: o.result ?? null, error: o.error?.message ?? null });
    rows.push({ stepId, tool: o.tool, status });
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

  // Execute the exact bound tool. Load through the service client after confirming
  // ownership, then re-check the policy + action hash so a changed approval can't run
  // something else.
  const admin = adminClient();
  const { data: tc } = await admin.from('agent_tool_calls').select('tool, args, status').eq('id', ap.tool_call_id).maybeSingle();
  if (!tc || tc.status !== 'pending') throw new HttpError(409, 'Tool call is not pending');
  const tool = resolveTool(tc.tool);
  if (!tool) throw new HttpError(409, 'Tool is no longer registered');
  if (!policyFor(tool).requiresApproval) throw new HttpError(409, 'Tool does not require approval');
  if (actionKeyFor(tc.tool, (tc.args ?? {}) as Record<string, unknown>) !== ap.action_hash) throw new HttpError(409, 'Approval does not match the proposed action');

  const source = await makeSource(admin, userId);
  try {
    const result = await tool.run((tc.args ?? {}) as Record<string, unknown>, { userId, source });
    await admin.from('agent_tool_calls').update({ status: 'succeeded', result }).eq('id', ap.tool_call_id);
    await admin.from('agent_approvals').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', approvalId);
    await admin.from('agent_runs').update({ status: 'completed' }).eq('id', ap.run_id);
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
