// Approval binding. Pure: an approval is tied to the exact tool + args so it can
// never be replayed against changed arguments. The key here is a deterministic
// canonical string; the DB layer stores a SHA-256 of it and single-use semantics.
export type Approval = {
  tool: string;
  args: Record<string, unknown>;
  actionKey: string;
  expiresAt: string;
};

/** Canonicalize args (sorted top-level keys) so key order cannot change a binding. */
export function canonicalArgs(args: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(args).sort()) sorted[k] = args[k];
  return JSON.stringify(sorted);
}

export function actionKeyFor(tool: string, args: Record<string, unknown>): string {
  return `${tool}\u0000${canonicalArgs(args)}`;
}

export function buildApproval(tool: string, args: Record<string, unknown>, expiresAt: string): Approval {
  return { tool, args, actionKey: actionKeyFor(tool, args), expiresAt };
}

/** True only when the proposed action is byte-identical to the approved one. */
export function matchesApproval(tool: string, args: Record<string, unknown>, approval: Approval): boolean {
  return approval.tool === tool && approval.actionKey === actionKeyFor(tool, args);
}
