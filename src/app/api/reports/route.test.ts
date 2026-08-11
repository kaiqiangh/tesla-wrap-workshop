import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  readProfileAccess: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/profile-access", () => ({
  readProfileAccess: mocks.readProfileAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServer,
}));
vi.mock("@/lib/wraps/problem", () => ({
  wrapProblem: (
    status: number,
    code: string,
    problem: string,
    rule: string,
    nextAction: string,
    headers: HeadersInit = {},
  ) =>
    new Response(
      JSON.stringify({ error: { code, problem, rule, nextAction } }),
      {
        status,
        headers: { "content-type": "application/json", ...headers },
      },
    ),
}));

import { POST } from "./route";

const key = "86000000-0000-4000-8000-000000000001";
const base = {
  targetKind: "WRAP",
  target: "night-drive-abc123",
  reason: "COPYRIGHT",
  idempotencyKey: key,
};

describe("POST /api/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServer.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("rejects malformed input before authentication", async () => {
    const response = await POST(jsonRequest({ target: "wrap" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("WF-REPORT-REQUEST");
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("requires an eligible signed-in Profile", async () => {
    mocks.readProfileAccess.mockResolvedValue({ status: "guest" });
    const guest = await POST(jsonRequest(base));
    expect(guest.status).toBe(401);
    expect((await guest.json()).error.code).toBe("WF-REPORT-AUTH");

    mocks.readProfileAccess.mockResolvedValue({ status: "incomplete" });
    const incomplete = await POST(jsonRequest(base));
    expect(incomplete.status).toBe(403);
    expect((await incomplete.json()).error.code).toBe(
      "WF-REPORT-PARTICIPATION",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns the private Report receipt and preserves no-store", async () => {
    mocks.readProfileAccess.mockResolvedValue({ status: "active" });
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: key,
          target_kind: "WRAP",
          target_id: "89000000-0000-0000-0000-000000000001",
          reason: "COPYRIGHT",
          detail: null,
          status: "OPEN",
          outcome_category: null,
          created_at: "2026-08-11T09:00:00Z",
          updated_at: "2026-08-11T09:00:00Z",
          resolved_at: null,
          created: true,
        },
      ],
      error: null,
    });

    const response = await POST(jsonRequest(base));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      report: {
        id: key,
        targetKind: "WRAP",
        targetId: "89000000-0000-0000-0000-000000000001",
        reason: "COPYRIGHT",
        detail: null,
        status: "OPEN",
        outcomeCategory: null,
        createdAt: "2026-08-11T09:00:00Z",
        updatedAt: "2026-08-11T09:00:00Z",
        resolvedAt: null,
        created: true,
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("create_report", {
      p_target_kind: "WRAP",
      p_target: "night-drive-abc123",
      p_reason: "COPYRIGHT",
      p_detail: "",
      p_idempotency_key: key,
    });
  });

  it("maps stable self, rate, and database failures", async () => {
    mocks.readProfileAccess.mockResolvedValue({ status: "active" });
    for (const [message, status, code] of [
      ["report_self_target", 409, "WF-REPORT-SELF"],
      ["report_hour_rate_limited", 429, "WF-REPORT-RATE"],
      ["opaque database detail", 503, "WF-REPORT-DATABASE"],
    ] as const) {
      mocks.rpc.mockResolvedValue({ data: null, error: { message } });
      const response = await POST(jsonRequest(base));
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.error.code).toBe(code);
      expect(JSON.stringify(body)).not.toContain("opaque database detail");
      if (status === 429)
        expect(response.headers.get("retry-after")).toBe("3600");
    }
  });
});

function jsonRequest(value: unknown) {
  return new Request("http://localhost/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
