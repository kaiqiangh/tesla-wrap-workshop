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

describe("POST /api/wraps/[slug]/engagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServer.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("rejects an incomplete action before authentication", async () => {
    const response = await POST(jsonRequest({ kind: "LIKE" }), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("WF-SOCIAL-REQUEST");
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    mocks.readProfileAccess.mockResolvedValue({ status: "guest" });
    const response = await POST(jsonRequest({ kind: "LIKE", enabled: true }), {
      params,
    });
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("WF-SOCIAL-AUTH");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns the authoritative idempotent state and counts", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.rpc.mockResolvedValue({
      data: [
        {
          kind: "LIKE",
          enabled: true,
          like_count: 3,
          favorite_count: 2,
        },
      ],
      error: null,
    });

    const response = await POST(jsonRequest({ kind: "LIKE", enabled: true }), {
      params,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "LIKE",
      enabled: true,
      likeCount: 3,
      favoriteCount: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("toggle_wrap_engagement", {
      p_enabled: true,
      p_kind: "LIKE",
      p_slug: "night-drive-abc123",
    });
  });

  it("maps self-actions and unavailable targets without leaking database text", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "social_self_action" },
    });
    const selfResponse = await POST(
      jsonRequest({ kind: "FAVORITE", enabled: true }),
      { params },
    );
    expect(selfResponse.status).toBe(403);
    expect((await selfResponse.json()).error.code).toBe("WF-SOCIAL-SELF");

    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "social_wrap_unavailable" },
    });
    const unavailableResponse = await POST(
      jsonRequest({ kind: "FAVORITE", enabled: true }),
      { params },
    );
    expect(unavailableResponse.status).toBe(409);
    expect((await unavailableResponse.json()).error.code).toBe(
      "WF-SOCIAL-WRAP",
    );
  });

  it("returns a stable database error when profile access or the RPC fails", async () => {
    mocks.readProfileAccess.mockRejectedValue(new Error("private detail"));
    const accessResponse = await POST(
      jsonRequest({ kind: "LIKE", enabled: false }),
      { params },
    );
    expect(accessResponse.status).toBe(503);
    expect((await accessResponse.json()).error.code).toBe("WF-SOCIAL-DATABASE");

    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "secret database detail" },
    });
    const rpcResponse = await POST(
      jsonRequest({ kind: "LIKE", enabled: false }),
      { params },
    );
    expect(rpcResponse.status).toBe(503);
    expect((await rpcResponse.json()).error.code).toBe("WF-SOCIAL-DATABASE");
  });

  it("maps the social rate limit with Retry-After", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "social_rate_limited" },
    });

    const response = await POST(
      jsonRequest({ kind: "FAVORITE", enabled: true }),
      { params },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect((await response.json()).error.code).toBe("WF-SOCIAL-RATE");
  });
});

function jsonRequest(value: unknown) {
  return new Request(
    "http://localhost/api/wraps/night-drive-abc123/engagement",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    },
  );
}
