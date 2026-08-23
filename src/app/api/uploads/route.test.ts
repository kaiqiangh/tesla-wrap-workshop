import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  createAdmin: vi.fn(),
  requireActiveProfile: vi.fn(),
}));

vi.mock("@/lib/auth/profile-access", () => ({
  requireActiveProfile: mocks.requireActiveProfile,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServer,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));
vi.mock("@/lib/upload/problem", () => ({
  uploadProblem: (
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

const body = {
  templateVariantId: "10000000-0000-0000-0000-000000000001",
  filename: "wrap.png",
  mimeType: "image/png",
  templateAsserted: true,
};

describe("POST /api/uploads", () => {
  it("returns only the safe Pending Upload identity", async () => {
    mocks.requireActiveProfile.mockResolvedValue({
      ok: true,
      username: "upload-one",
      userId: "10000000-0000-0000-0000-000000000004",
    });
    mocks.createServer.mockResolvedValue({});
    mocks.createAdmin.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: [
          {
            id: "10000000-0000-0000-0000-000000000002",
            expires_at: "2026-08-10T00:00:00Z",
          },
        ],
        error: null,
      })),
    });
    const response = await POST(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: "10000000-0000-0000-0000-000000000002",
      expires_at: "2026-08-10T00:00:00Z",
    });
  });

  it("maps the database rate limit to the public contract", async () => {
    mocks.requireActiveProfile.mockResolvedValue({
      ok: true,
      username: "upload-one",
      userId: "10000000-0000-0000-0000-000000000004",
    });
    mocks.createServer.mockResolvedValue({});
    mocks.createAdmin.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: "upload_rate_limited" },
      })),
    });
    const response = await POST(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect((await response.json()).error).toMatchObject({
      code: "WF-UPLOAD-RATE",
    });
  });
});
