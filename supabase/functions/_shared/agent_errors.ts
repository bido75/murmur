// Structured agent errors: stable codes for the API, retry flags for the executor,
// and user-safe messages. Pure.
export type AgentErrorCode =
  | 'unknown_tool'
  | 'tool_not_allowed'
  | 'budget_exceeded'
  | 'invalid_plan'
  | 'tool_failed'
  | 'approval_required';

export class AgentError extends Error {
  code: AgentErrorCode;
  retryable: boolean;
  constructor(code: AgentErrorCode, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = 'AgentError';
  }
}

export class UnknownToolError extends AgentError {
  constructor(name: string) {
    super('unknown_tool', `Tool "${name}" is not registered`, false);
  }
}

export class ToolNotAllowedError extends AgentError {
  constructor(name: string, reason: string) {
    super('tool_not_allowed', `Tool "${name}" is not allowed: ${reason}`, false);
  }
}

export class BudgetExceededError extends AgentError {
  constructor(what: string) {
    super('budget_exceeded', `Execution budget exceeded (${what})`, false);
  }
}

export class InvalidPlanError extends AgentError {
  constructor(reason: string) {
    super('invalid_plan', reason, false);
  }
}

export class ApprovalRequiredError extends AgentError {
  constructor(tool: string) {
    super('approval_required', `Tool "${tool}" requires approval`, false);
  }
}

export class ToolExecutionError extends AgentError {
  constructor(tool: string, message: string) {
    super('tool_failed', `${tool}: ${message}`, true);
  }
}

/** Normalize any thrown value into an AgentError so a run reports a stable code. */
// deno-lint-ignore no-explicit-any
export function toAgentError(e: any, tool?: string): AgentError {
  if (e instanceof AgentError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return tool ? new ToolExecutionError(tool, message) : new InvalidPlanError(message);
}
