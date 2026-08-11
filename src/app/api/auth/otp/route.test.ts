import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  auth: { signInWithOtp: vi.fn(), verifyOtp: vi.fn() },
  createAdmin: vi.fn(),
  createServer: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  readServerEnvironment: () => ({
    NEXT_PUBLIC_SITE_URL: "http://localhost",
    DOWNLOAD_PRINCIPAL_HMAC_SECRET: "x".repeat(32),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServer,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/auth/otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "192.0.2.10",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/otp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdmin.mockReturnValue({ rpc: mocks.adminRpc });
    mocks.createServer.mockResolvedValue({ auth: mocks.auth });
    mocks.adminRpc.mockResolvedValue({ data: null, error: null });
    mocks.auth.signInWithOtp.mockResolvedValue({ error: null });
    mocks.auth.verifyOtp.mockResolvedValue({ error: null });
  });

  it("rejects malformed or invalid email input", async () => {
    expect((await POST(request({ action: "send" }))).status).toBe(400);
    expect((await POST(request({ action: "send", email: "bad" }))).status).toBe(
      400,
    );
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("rejects cross-site OTP requests before consuming a bucket", async () => {
    const crossSite = request({ action: "send", email: "a@example.com" });
    crossSite.headers.set("origin", "https://evil.example");
    expect((await POST(crossSite)).status).toBe(403);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("consumes server-side limits before sending a code", async () => {
    const response = await POST(
      request({ action: "send", email: " User@Example.com " }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.adminRpc).toHaveBeenCalledWith("consume_otp_limit", {
      p_email_principal: expect.stringMatching(/^v2:email:[0-9a-f]{64}$/),
      p_network_principal: expect.stringMatching(/^v2:network:[0-9a-f]{64}$/),
    });
    expect(mocks.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "user@example.com",
      options: { shouldCreateUser: true },
    });
  });

  it("maps the N+1 boundary with Retry-After and records verification failures", async () => {
    mocks.adminRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "otp_email_minute_rate_limited" },
    });
    const limited = await POST(
      request({ action: "send", email: "a@example.com" }),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(mocks.auth.signInWithOtp).not.toHaveBeenCalled();

    mocks.auth.verifyOtp.mockResolvedValueOnce({
      error: { message: "invalid_token" },
    });
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: null });
    const failure = await POST(
      request({ action: "verify", email: "a@example.com", token: "123456" }),
    );
    expect(failure.status).toBe(400);
    expect(mocks.adminRpc).toHaveBeenLastCalledWith(
      "consume_otp_failure_limit",
      {
        p_email_principal: expect.stringMatching(/^v2:email:[0-9a-f]{64}$/),
        p_network_principal: expect.stringMatching(/^v2:network:[0-9a-f]{64}$/),
      },
    );
  });
});
