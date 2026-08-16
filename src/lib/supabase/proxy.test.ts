import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { refreshSupabaseSession } from "./proxy";

describe("Supabase session refresh", () => {
  beforeEach(() => {
    vi.stubEnv("WRAPFORGE_ENVIRONMENT", "local");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getClaims: async () => {
          options.cookies.setAll([
            {
              name: "sb-local-auth-token",
              value: "rotated-token",
              options: { maxAge: 3600, path: "/" },
            },
          ]);
          return { data: { claims: {} }, error: null };
        },
      },
    }));
  });

  it("keeps rotated auth cookie attributes", async () => {
    const response = await refreshSupabaseSession(
      new NextRequest("http://localhost/upload", {
        headers: { cookie: "sb-local-auth-token=old-token" },
      }),
    );

    const cookie = response.cookies.get("sb-local-auth-token");
    expect(cookie?.value).toBe("rotated-token");
    expect(cookie?.maxAge).toBe(3600);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
  });
});
