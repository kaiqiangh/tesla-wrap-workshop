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
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
          ...headers,
        },
      },
    ),
}));

import { POST } from "./route";

const params = Promise.resolve({ username: "road-renamed" });

describe("POST /api/profiles/[username]/follow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServer.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("rejects an incomplete request before authentication", async () => {
    const response = await POST(jsonRequest({}), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("WF-FOLLOW-REQUEST");
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    mocks.requireActiveProfile.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ error: { code: "WF-FOLLOW-AUTH" } }),
        { status: 401 },
      ),
    });
    const response = await POST(jsonRequest({ enabled: true }), { params });
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("WF-FOLLOW-AUTH");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("denies non-active Profiles before the RPC", async () => {
    mocks.requireActiveProfile.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ error: { code: "WF-FOLLOW-PARTICIPATION" } }),
        { status: 403 },
      ),
    });
    const response = await POST(jsonRequest({ enabled: true }), { params });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("WF-FOLLOW-PARTICIPATION");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns the authoritative following state and count", async () => {
    mocks.requireActiveProfile.mockResolvedValue({
      ok: true,
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.rpc.mockResolvedValue({
      data: [{ following: true, follower_count: 4 }],
      error: null,
    });

    const response = await POST(jsonRequest({ enabled: true }), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      following: true,
      followerCount: 4,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("toggle_creator_follow", {
      p_enabled: true,
      p_username: "road-renamed",
    });
  });

  it("maps target, participation, and database failures without leaking details", async () => {
    mocks.requireActiveProfile.mockResolvedValue({
      ok: true,
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "follow_creator_unavailable" },
    });
    const targetResponse = await POST(jsonRequest({ enabled: true }), {
      params,
    });
    expect(targetResponse.status).toBe(409);
    expect((await targetResponse.json()).error.code).toBe("WF-FOLLOW-CREATOR");

    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "follow_actor_unavailable" },
    });
    const actorResponse = await POST(jsonRequest({ enabled: false }), {
      params,
    });
    expect(actorResponse.status).toBe(403);
    expect((await actorResponse.json()).error.code).toBe(
      "WF-FOLLOW-PARTICIPATION",
    );

    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "follow_rate_limited" },
    });
    const rateResponse = await POST(jsonRequest({ enabled: true }), {
      params,
    });
    expect(rateResponse.status).toBe(429);
    expect(rateResponse.headers.get("retry-after")).toBe("60");
    expect((await rateResponse.json()).error.code).toBe("WF-FOLLOW-RATE");

    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private database detail" },
    });
    const databaseResponse = await POST(jsonRequest({ enabled: false }), {
      params,
    });
    expect(databaseResponse.status).toBe(503);
    const databaseBody = await databaseResponse.json();
    expect(databaseBody.error.code).toBe("WF-FOLLOW-DATABASE");
    expect(JSON.stringify(databaseBody)).not.toContain(
      "private database detail",
    );
  });
});

function jsonRequest(value: unknown) {
  return new Request("http://localhost/api/profiles/road-renamed/follow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
