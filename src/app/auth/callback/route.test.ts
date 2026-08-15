import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServer,
}));

import { GET } from "./route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000");
    vi.stubEnv("WRAPFORGE_ENVIRONMENT", "local");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    mocks.createServer.mockReset();
  });

  it("rejects missing codes and sanitizes the next path", async () => {
    const response = await GET(
      new Request(
        "http://127.0.0.1:3000/auth/callback?next=https%3A%2F%2Fattacker.example",
      ),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/sign-in?error=oauth_failed&next=%2F",
    );
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("maps a provider exchange failure to the stable sign-in error", async () => {
    mocks.createServer.mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi
          .fn()
          .mockResolvedValue({ error: new Error("provider detail") }),
      },
    });
    const response = await GET(
      new Request(
        "http://127.0.0.1:3000/auth/callback?code=expired&next=%2Fupload",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/sign-in?error=oauth_failed&next=%2Fupload",
    );
  });

  it("maps an unexpected Supabase client failure to the stable sign-in error", async () => {
    mocks.createServer.mockRejectedValue(new Error("database unavailable"));
    const response = await GET(
      new Request(
        "http://127.0.0.1:3000/auth/callback?code=valid&next=%2Fupload",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/sign-in?error=oauth_failed&next=%2Fupload",
    );
  });

  it("maps an unexpected code exchange failure to the stable sign-in error", async () => {
    mocks.createServer.mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi
          .fn()
          .mockRejectedValue(new Error("database unavailable")),
      },
    });
    const response = await GET(
      new Request(
        "http://127.0.0.1:3000/auth/callback?code=valid&next=%2Fupload",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/sign-in?error=oauth_failed&next=%2Fupload",
    );
  });

  it("continues to auth completion after a successful PKCE exchange", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    mocks.createServer.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });
    const response = await GET(
      new Request(
        "http://127.0.0.1:3000/auth/callback?code=valid&next=%2Fupload",
      ),
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith("valid");
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/auth/complete?next=%2Fupload",
    );
  });
});
