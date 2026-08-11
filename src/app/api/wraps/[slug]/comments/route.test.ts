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

const params = Promise.resolve({ slug: "night-drive-abc123" });
const key = "86000000-0000-4000-8000-000000000001";

describe("POST /api/wraps/[slug]/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServer.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("rejects malformed input before authentication", async () => {
    const response = await POST(jsonRequest({ body: "hello" }), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("WF-COMMENT-REQUEST");
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("requires an eligible signed-in Profile", async () => {
    mocks.readProfileAccess.mockResolvedValue({ status: "guest" });
    const guest = await POST(
      jsonRequest({ body: "hello", idempotencyKey: key }),
      {
        params,
      },
    );
    expect(guest.status).toBe(401);
    expect((await guest.json()).error.code).toBe("WF-COMMENT-AUTH");

    mocks.readProfileAccess.mockResolvedValue({ status: "incomplete" });
    const incomplete = await POST(
      jsonRequest({ body: "hello", idempotencyKey: key }),
      { params },
    );
    expect(incomplete.status).toBe(403);
    expect((await incomplete.json()).error.code).toBe(
      "WF-COMMENT-PARTICIPATION",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns an authoritative Comment and count", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: key,
          body: "hello",
          author_username: "road-one",
          author_display_name: "Road One",
          created_at: "2026-08-11T09:00:00Z",
          comment_count: 2,
        },
      ],
      error: null,
    });
    const response = await POST(
      jsonRequest({ body: "hello", idempotencyKey: key }),
      { params },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      comment: {
        id: key,
        body: "hello",
        authorUsername: "road-one",
        authorDisplayName: "Road One",
        createdAt: "2026-08-11T09:00:00Z",
        ownedByViewer: true,
      },
      commentCount: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("add_wrap_comment", {
      p_body: "hello",
      p_idempotency_key: key,
      p_slug: "night-drive-abc123",
    });
  });

  it("maps target, rate, and database failures without leaking details", async () => {
    mocks.readProfileAccess.mockResolvedValue({ status: "active" });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "comment_wrap_unavailable" },
    });
    const target = await POST(
      jsonRequest({ body: "hello", idempotencyKey: key }),
      { params },
    );
    expect(target.status).toBe(409);
    expect((await target.json()).error.code).toBe("WF-COMMENT-WRAP");

    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "comment_minute_rate_limited" },
    });
    const rate = await POST(
      jsonRequest({ body: "hello", idempotencyKey: key }),
      { params },
    );
    expect(rate.status).toBe(429);
    expect(rate.headers.get("retry-after")).toBe("60");

    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "secret database detail" },
    });
    const database = await POST(
      jsonRequest({ body: "hello", idempotencyKey: key }),
      { params },
    );
    expect(database.status).toBe(503);
    expect(JSON.stringify(await database.json())).not.toContain(
      "secret database detail",
    );
  });
});

function jsonRequest(value: unknown) {
  return new Request("http://localhost/api/wraps/night-drive-abc123/comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
