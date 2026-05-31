import { randomUUID } from "node:crypto";
import type { SandboxMode } from "../src/harness/permissions";

type PendingApproval = {
  input: string;
  sandbox: SandboxMode;
};

export type ApprovalGateResult =
  | { ok: true }
  | {
      error: string;
      ok: false;
    };

export class ApprovalGate {
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  createApproval(input: string, sandbox: SandboxMode) {
    const token = `approval-${randomUUID()}`;

    this.pendingApprovals.set(token, { input, sandbox });

    return token;
  }

  approveRequest(input: string, sandbox?: SandboxMode, token?: string): ApprovalGateResult {
    if (!sandbox || sandbox === "read-only" || sandbox === "workspace-write") {
      return { ok: true };
    }

    const approval = token ? this.pendingApprovals.get(token) : undefined;

    if (!approval || approval.input !== input || approval.sandbox !== sandbox) {
      return {
        error: "Sandbox escalation requires a matching approval token",
        ok: false,
      };
    }

    this.pendingApprovals.delete(token!);

    return { ok: true };
  }
}
