import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));
mocks.refresh.mockResolvedValue(NextResponse.next());
vi.mock("@/lib/supabase/proxy", () => ({
  refreshSupabaseSession: mocks.refresh,
}));

import { proxy } from "./proxy";

describe("global mutation boundary", () => {
  beforeEach(() => {
    vi.stubEnv("WRAPFORGE_ENVIRONMENT", "local");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("rejects cross-site mutations with correlation and security headers", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/api/profile/settings", {
        method: "POST",
        headers: {
          host: "localhost",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
