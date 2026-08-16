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

import { GET } from "./route";

const id = "86000000-0000-4000-8000-000000000001";
const params = Promise.resolve({ id });

describe("GET /api/reports/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServer.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("rejects malformed identifiers before authentication", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("WF-REPORT-REQUEST");
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("requires authentication and returns only the reporter receipt", async () => {
    mocks.readProfileAccess.mockResolvedValue({ status: "guest" });
    const guest = await GET(new Request("http://localhost"), { params });
    expect(guest.status).toBe(401);

    mocks.readProfileAccess.mockResolvedValue({ status: "suspended" });
    const suspended = await GET(new Request("http://localhost"), { params });
    expect(suspended.status).toBe(403);
    expect((await suspended.json()).error.code).toBe("WF-REPORT-PARTICIPATION");

    mocks.readProfileAccess.mockResolvedValue({ status: "active" });
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id,
          target_kind: "WRAP",
          target_id: "89000000-0000-0000-0000-000000000001",
          reason: "COPYRIGHT",
          detail: null,
          status: "OPEN",
          outcome_category: null,
          created_at: "2026-08-11T09:00:00Z",
          updated_at: "2026-08-11T09:00:00Z",
          resolved_at: null,
        },
      ],
      error: null,
    });
    const receipt = await GET(new Request("http://localhost"), { params });
    expect(receipt.status).toBe(200);
    expect(receipt.headers.get("cache-control")).toBe("no-store");
    expect((await receipt.json()).report).toMatchObject({
      id,
      targetKind: "WRAP",
      status: "OPEN",
      reason: "COPYRIGHT",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("get_my_report", {
      p_report_id: id,
    });
  });

  it("distinguishes missing receipts from database failures", async () => {
    mocks.readProfileAccess.mockResolvedValue({ status: "active" });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const missing = await GET(new Request("http://localhost"), { params });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("WF-REPORT-NOT-FOUND");

    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private database detail" },
    });
    const failed = await GET(new Request("http://localhost"), { params });
    expect(failed.status).toBe(503);
    expect((await failed.json()).error.code).toBe("WF-REPORT-DATABASE");
  });
});
