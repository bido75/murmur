// Tool policy: what may run automatically vs what must pause for approval. Pure.
// Phase 1 registers only read-only tools, so the approval branch is exercised in
// Phase 4 when mutation tools (task/calendar/export/followup) are exposed.
import type { AgentTool, PolicyDecision } from './agent_types.ts';

export function policyFor(tool: AgentTool): PolicyDecision {
  if (tool.riskLevel === 'read' && !tool.requiresApproval) {
    return { allowed: true, requiresApproval: false };
  }
  // Write/external tools are allowed only through an approval gate. The gate itself
  // (approve/reject + idempotent execution) lands with Phase 4; until then such tools
  // are simply never registered, so this branch stays reachable but inactive.
  return { allowed: true, requiresApproval: true };
}
