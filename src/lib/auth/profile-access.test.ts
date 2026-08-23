import { describe, expect, it, vi } from "vitest";

import type { OperationContext } from "../observability";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  currentProfileAccess: vi.fn(),
}));

vi.mock("../../supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks),
}));

import { requireActiveProfile } from "./profile-access";

function supabase() {
  return {
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.currentProfileAccess,
  } as never;
}

function operation(): OperationContext {
  return {
    correlationId: "t",
    action: "TEST",
    targetType: "DISCOVERY",
    startedAt: Date.now(),
  };
}

function problem(status: number, code: string) {
  return new Response(JSON.stringify({ error: { code } }), { status });
}

const codes = {
  auth: "WF-TEST-AUTH",
  participation: "WF-TEST-PARTICIPATION",
  db: "WF-TEST-DATABASE",
};

describe("requireActiveProfile", () => {
  it("returns the guest 401 problem without touching the actor", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    const op = operation();
    const gate = await requireActiveProfile(supabase(), op, problem, codes);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(401);
    expect(op.actorId).toBeUndefined();
  });

  it("returns the participation 403 problem and records the actor", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "30000000-0000-0000-0000-000000000001" } },
      error: null,
    });
    mocks.currentProfileAccess.mockResolvedValue({
      data: [{ may_onboard: true, may_participate: false }],
      error: null,
    });
    const op = operation();
    const gate = await requireActiveProfile(supabase(), op, problem, codes);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(403);
    expect(op.actorId).toBe("30000000-0000-0000-0000-000000000001");
  });

  it("maps a Profile read failure to the database problem", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "30000000-0000-0000-0000-000000000002" } },
      error: null,
    });
    mocks.currentProfileAccess.mockRejectedValue(new Error("down"));
    const gate = await requireActiveProfile(supabase(), operation(), problem, codes);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(503);
  });

  it("admits an Active Profile and exposes its identity", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "30000000-0000-0000-0000-000000000003" } },
      error: null,
    });
    mocks.currentProfileAccess.mockResolvedValue({
      data: [
        { may_onboard: true, may_participate: true, username: "maker" },
      ],
      error: null,
    });
    const gate = await requireActiveProfile(supabase(), operation(), problem, codes);
    expect(gate).toEqual({
      ok: true,
      username: "maker",
      userId: "30000000-0000-0000-0000-000000000003",
    });
  });
});