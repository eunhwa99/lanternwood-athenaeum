import { describe, expect, it } from "vitest";
import { ApprovalGate } from "./approvalGate";

describe("approval gate", () => {
  it("allows the default workspace-write sandbox without approval", () => {
    const gate = new ApprovalGate();

    expect(gate.approveRequest("Draft a plan")).toEqual({ ok: true });
    expect(gate.approveRequest("Draft a plan", "read-only")).toEqual({ ok: true });
    expect(gate.approveRequest("Draft a plan", "workspace-write")).toEqual({ ok: true });
  });

  it("rejects broader sandboxes without a matching approval token", () => {
    const gate = new ApprovalGate();

    expect(gate.approveRequest("Draft a plan", "danger-full-access")).toEqual({
      error: "Sandbox escalation requires a matching approval token",
      ok: false,
    });
  });

  it("allows a broader sandbox once with a matching approval token", () => {
    const gate = new ApprovalGate();
    const token = gate.createApproval("Draft a plan", "danger-full-access");

    expect(token).toEqual(expect.stringMatching(/^approval-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
    expect(gate.approveRequest("Different task", "danger-full-access", token).ok).toBe(false);
    expect(gate.approveRequest("Draft a plan", "danger-full-access", token)).toEqual({ ok: true });
    expect(gate.approveRequest("Draft a plan", "danger-full-access", token).ok).toBe(false);
  });
});
