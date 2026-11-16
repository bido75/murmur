// Shared types for the native agent runtime. Pure — no Deno or Node APIs, so these
// can be unit-tested with `npm test` (node --experimental-strip-types).
import type { Source } from './mcp.ts';

export type AgentToolRisk = 'read' | 'write' | 'external';

export type AgentToolContext = {
  userId: string;
  source: Source;
};

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissionScope: string;
  riskLevel: AgentToolRisk;
  /** Read tools run automatically; write/external tools pause for approval (Phase 4). */
  requiresApproval: boolean;
  run: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<unknown>;
};

export type PlanStep = { tool: string; args: Record<string, unknown> };

export type StepOutcome = {
  stepIndex: number;
  tool: string;
  status: 'succeeded' | 'failed' | 'awaiting_approval';
  result?: unknown;
  /** Set when the step is paused for approval, so the approval can bind to the args. */
  args?: Record<string, unknown>;
  error?: { code: string; message: string };
};

export type RunStatus = 'running' | 'awaiting_approval' | 'completed' | 'failed';

export type RunSummary = { status: RunStatus; steps: StepOutcome[] };

export type PolicyDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
};
