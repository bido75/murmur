// Native agent entry point (Phase 1): a bounded, read-only plan-and-execute loop.
//
//   POST /runs                 { objective, idempotency_key?, run_id? } -> run + summary
//   GET  /runs/{id}            -> persisted run + steps (RLS owner-only)
//   POST /runs/{id}/cancel     -> mark a non-terminal run cancelled
//   POST /runs/{id}/resume     -> 501 (re-entry lands with approval-gated mutations, Phase 4)
//
// Auth is the Supabase session (requireUser). Reads go through the same scoped Source
// the MCP server uses (makeSource + adminClient + explicit uid), so the agent can only
// touch what that user can see. The agent never runs code/SQL/network itself: the LLM
// only proposes a plan, which is validated and executed through the typed registry.
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
import { AgentError, toAgentError, UnknownToolError } from '../_shared/agent_errors.ts';
import type { StepOutcome } from '../_shared/agent_types.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const path = new URL(req.url).pathname;
  try {
    const { id: userId, client } = await requireUser(req);

    if (req.method === 'POST' && /\/runs$/.test(path)) {
      return await createRun(client, userId, await req.json());
    }
    if (req.method === 'GET' && /\/runs\/[0-9a-fA-F-]{36}$/.test(path)) {
      return await getRun(client, runIdFrom(path));
    }
    if (req.method === 'POST' && /\/runs\/[0-9a-fA-F-]{36}\/cancel$/.test(path)) {
      return await cancelRun(client, runIdFrom(path));
    }
    if (req.method === 'POST' && /\/runs\/[0-9a-fA-F-]{36}\/resume$/.test(path)) {
      return json({ error: 'resume is added in Phase 4 (with approval-gated mutations)' }, 501);
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});

function runIdFrom(path: string): string {
  const m = path.match(/\/runs\/([0-9a-fA-F-]{36})/);
  return m ? m[1] : '';
}

async function createRun(client: Supa, userId: string, body: { objective?: string; idempotency_key?: string; run_id?: string }) {
  const objective = String(body?.objective ?? '').trim();
  if (!objective) throw new HttpError(400, 'objective is required');
  if (objective.length > 2000) throw new HttpError(400, 'objective is too long');

  // Idempotent create: a repeated request with the same key returns the existing run.
  const key = String(body?.idempotency_key ?? '').trim() || null;
  const runId = String(body?.run_id ?? '').trim() || crypto.randomUUID();
  if (!UUID.test(runId)) throw new HttpError(400, 'run_id must be a uuid');

  const { data: existing } = key
    ? await client.from('agent_runs').select('id, status').eq('user_id', userId).eq('idempotency_key', key).maybeSingle()
    : { data: null };
  if (existing?.id) {
    return json({ run_id: existing.id, status: existing.status, reused: true });
  }

  await client.from('agent_runs').insert({
    id: runId,
    user_id: userId,
    intent: 'general',
    status: 'running',
    plan: [],
    idempotency_key: key,
  });
  await client.from('agent_messages').insert({ run_id: runId, user_id: userId, role: 'user', content: objective });

  // The scoped read surface — the same one the MCP server exposes, so the agent cannot
  // cross a tenant boundary (readable_* RPCs are uid-scoped security-definer functions).
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

  const steps: StepOutcome[] = [];
  deps.onStep = (o) => void steps.push(o);

  try {
    const summary = await runAgent(objective, deps);
    await persist(client, runId, steps, summary.status);
    return json({ run_id: runId, status: summary.status, steps: steps });
  } catch (e) {
    const err: AgentError = toAgentError(e);
    await client.from('agent_runs').update({ status: 'failed' }).eq('id', runId);
    return json({ run_id: runId, status: 'failed', error: { code: err.code, message: err.message } }, 400);
  }
}

async function persist(client: Supa, runId: string, outcomes: StepOutcome[], status: string) {
  if (outcomes.length) {
    await client.from('agent_steps').insert(
      outcomes.map((o, i) => ({
        run_id: runId,
        step_index: i,
        tool: o.tool,
        status: o.status === 'succeeded' ? 'succeeded' : o.status === 'awaiting_approval' ? 'awaiting_approval' : 'failed',
        output: o.result ?? null,
        error: o.error?.message ?? null,
      })),
    );
  }
  const next = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'awaiting_approval';
  await client.from('agent_runs').update({ status: next }).eq('id', runId);
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
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return json({ run_id: runId, status: run.status, changed: false });
  }
  await client.from('agent_runs').update({ status: 'cancelled' }).eq('id', runId);
  return json({ run_id: runId, status: 'cancelled', changed: true });
}
