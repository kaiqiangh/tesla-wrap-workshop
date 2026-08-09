import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  readProfileAccess: vi.fn(),
}));

vi.mock("@/lib/auth/profile-access", () => ({
  readProfileAccess: mocks.readProfileAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServer,
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
  it("returns the server-issued Pending Upload key", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "upload-one",
    });
    mocks.createServer.mockResolvedValue({
      rpc: vi.fn(async () => ({
        data: [
          {
            id: "10000000-0000-0000-0000-000000000002",
            staging_key: "owner/revision/source.png",
            idempotency_key: "10000000-0000-0000-0000-000000000003",
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
    expect((await response.json()).staging_key).toBe(
      "owner/revision/source.png",
    );
  });

  it("maps the database rate limit to the public contract", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "upload-one",
    });
    mocks.createServer.mockResolvedValue({
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
