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

import { DELETE } from "./route";

const id = "86000000-0000-4000-8000-000000000001";
const params = Promise.resolve({ id });

describe("DELETE /api/comments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServer.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("rejects malformed identifiers before authentication", async () => {
    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("WF-COMMENT-REQUEST");
  });

  it("maps Guest, owner, unavailable, and database outcomes", async () => {
    mocks.readProfileAccess.mockResolvedValue({ status: "guest" });
    const guest = await DELETE(new Request("http://localhost"), { params });
    expect(guest.status).toBe(401);

    mocks.readProfileAccess.mockResolvedValue({ status: "active" });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "comment_not_owner" },
    });
    const owner = await DELETE(new Request("http://localhost"), { params });
    expect(owner.status).toBe(403);
    expect((await owner.json()).error.code).toBe("WF-COMMENT-OWNER");

    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "comment_unavailable" },
    });
    const unavailable = await DELETE(new Request("http://localhost"), {
      params,
    });
    expect(unavailable.status).toBe(409);

    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private database detail" },
    });
    const database = await DELETE(new Request("http://localhost"), { params });
    expect(database.status).toBe(503);
    expect(JSON.stringify(await database.json())).not.toContain(
      "private database detail",
    );
  });

  it("returns the authoritative removal and count", async () => {
    mocks.readProfileAccess.mockResolvedValue({ status: "active" });
    mocks.rpc.mockResolvedValue({
      data: [{ id, removed: true, comment_count: 0 }],
      error: null,
    });
    const response = await DELETE(new Request("http://localhost"), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      id,
      removed: true,
      commentCount: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("remove_wrap_comment", {
      p_comment_id: id,
    });
  });
});
