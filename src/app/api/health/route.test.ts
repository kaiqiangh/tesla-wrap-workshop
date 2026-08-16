import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000");
    vi.stubEnv("WRAPFORGE_ENVIRONMENT", "local");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
    vi.stubEnv("DOWNLOAD_PRINCIPAL_HMAC_SECRET", "a".repeat(32));
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567");
  });

  it("returns only release identity and migration readiness", async () => {
    mocks.createAdmin.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ count: 1, error: null }),
      })),
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      sha: "abcdef1234567",
      environment: "local",
      migrationReady: true,
    });
  });

  it("fails closed without exposing the database error", async () => {
    mocks.createAdmin.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({
          count: null,
          error: { message: "private database connection detail" },
        }),
      })),
    });
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "not_ready",
      migrationReady: false,
    });
    expect(JSON.stringify(body)).not.toContain(
      "private database connection detail",
    );
  });

  it("redacts an invalid environment identity", async () => {
    vi.stubEnv("WRAPFORGE_ENVIRONMENT", "not-a-real-environment");
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
      environment: "unknown",
      migrationReady: false,
    });
  });
});
