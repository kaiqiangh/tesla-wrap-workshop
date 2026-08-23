import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  requireActiveProfile: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/profile-access", () => ({
  requireActiveProfile: mocks.requireActiveProfile,
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

import { GET, POST } from "./route";

const reportId = "96000000-0000-4000-8000-000000000001";
const key = "96000000-0000-4000-8000-000000000002";

describe("/api/admin/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServer.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("rejects guests and malformed actions before RPC", async () => {
    mocks.requireActiveProfile.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ error: { code: "WF-ADMIN-AUTH" } }),
        { status: 401 },
      ),
    });
    const guest = await GET(new Request("http://localhost/api/admin/reports"));
    expect(guest.status).toBe(401);

    const malformed = await POST(
      jsonRequest({
        reportId,
        actionKind: "HIDE",
        reason: "SPAM",
        idempotencyKey: "bad",
      }),
    );
    expect(malformed.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects cross-site state changes before authentication", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({
          reportId,
          actionKind: "HIDE",
          reason: "SPAM",
          idempotencyKey: key,
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("WF-ADMIN-CSRF");
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("returns a no-store queue projection for a current administrator", async () => {
    mocks.requireActiveProfile.mockResolvedValue({
      ok: true,
      username: "admin-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: reportId,
          target_kind: "WRAP",
          target_id: "96000000-0000-0000-0000-000000000003",
          target_ref: "fixture-wrap",
          target_summary: "Fixture Wrap",
          target_state: "PUBLISHED",
          reporter_ref: "96000000",
          reason: "SPAM",
          detail: "Unsafe",
          status: "OPEN",
          outcome_category: null,
          admin_note: null,
          created_at: "2026-08-11T10:00:00Z",
          updated_at: "2026-08-11T10:00:00Z",
          resolved_at: null,
          last_action_kind: null,
          last_action_reason: null,
          last_action_at: null,
        },
      ],
      error: null,
    });
    const response = await GET(
      new Request("http://localhost/api/admin/reports?status=open"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).reports[0]).toMatchObject({
      id: reportId,
      targetKind: "WRAP",
      reporterRef: "96000000",
      adminNote: null,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("list_admin_reports", {
      p_status: "OPEN",
    });
  });

  it("maps revoked admins, conflicts, and opaque failures", async () => {
    mocks.requireActiveProfile.mockResolvedValue({
      ok: true,
      username: "admin-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    for (const [message, status, code] of [
      ["admin_required", 403, "WF-ADMIN-DENIED"],
      ["moderation_conflict", 409, "WF-ADMIN-CONFLICT"],
      ["moderation_rate_limited", 429, "WF-ADMIN-RATE"],
      ["opaque moderation failure", 503, "WF-ADMIN-DATABASE"],
    ] as const) {
      mocks.rpc.mockResolvedValue({ data: null, error: { message } });
      const response = await POST(
        jsonRequest({
          reportId,
          actionKind: "HIDE",
          reason: "SPAM",
          privateNote: "note",
          idempotencyKey: key,
        }),
      );
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.error.code).toBe(code);
      expect(JSON.stringify(body)).not.toContain("opaque moderation failure");
      if (status === 429)
        expect(response.headers.get("retry-after")).toBe("3600");
    }
  });

  it("returns the authoritative moderation result", async () => {
    mocks.requireActiveProfile.mockResolvedValue({
      ok: true,
      username: "admin-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.rpc.mockResolvedValue({
      data: [
        {
          report_id: reportId,
          report_status: "RESOLVED",
          outcome_category: "CONTENT_HIDDEN",
          action_id: "96000000-0000-4000-8000-000000000004",
          action_created: true,
          target_kind: "WRAP",
          target_id: "96000000-0000-0000-0000-000000000003",
          target_state: "HIDDEN",
        },
      ],
      error: null,
    });
    const response = await POST(
      jsonRequest({
        reportId,
        actionKind: "HIDE",
        reason: "SPAM",
        idempotencyKey: key,
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).moderation).toMatchObject({
      reportId,
      reportStatus: "RESOLVED",
      targetState: "HIDDEN",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("moderate_report", {
      p_report_id: reportId,
      p_action_kind: "HIDE",
      p_reason: "SPAM",
      p_private_note: "",
      p_outcome_category: "",
      p_idempotency_key: key,
    });
  });
});

function jsonRequest(value: unknown) {
  return new Request("http://localhost/api/admin/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
