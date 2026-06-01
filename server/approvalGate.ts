import { randomUUID } from "node:crypto";
import type { SandboxMode } from "../src/harness/permissions";

type PendingApproval = {
  agentId?: string;
  input: string;
  route?: string;
  sandbox: SandboxMode;
  taskId?: string;
  workspacePath?: string;
};

export type ApprovalScope = Pick<PendingApproval, "agentId" | "route" | "taskId" | "workspacePath">;

export type ApprovalGateResult =
  | { ok: true }
  | {
      error: string;
      ok: false;
    };

export class ApprovalGate {
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  createApproval(input: string, sandbox: SandboxMode, scope: ApprovalScope = {}) {
    const token = `approval-${randomUUID()}`;

    this.pendingApprovals.set(token, { ...scope, input, sandbox });

    return token;
  }

  approveRequest(input: string, sandbox?: SandboxMode, token?: string, scope: ApprovalScope = {}): ApprovalGateResult {
    if (!sandbox || sandbox === "read-only" || sandbox === "workspace-write") {
      return { ok: true };
    }

    const approval = token ? this.pendingApprovals.get(token) : undefined;

    if (
      !approval ||
      approval.input !== input ||
      approval.route !== scope.route ||
      approval.sandbox !== sandbox ||
      approval.agentId !== scope.agentId ||
      approval.taskId !== scope.taskId ||
      approval.workspacePath !== scope.workspacePath
    ) {
      return {
        error: "Sandbox escalation requires a matching approval token",
        ok: false,
      };
    }

    this.pendingApprovals.delete(token!);

    return { ok: true };
  }
}
