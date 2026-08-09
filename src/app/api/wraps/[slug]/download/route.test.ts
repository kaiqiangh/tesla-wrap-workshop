import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  createAdmin: vi.fn(),
  createServer: vi.fn(),
  readProfileAccess: vi.fn(),
  cookies: vi.fn(),
  createSigned: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth/profile-access", () => ({
  readProfileAccess: mocks.readProfileAccess,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServer,
}));
vi.mock("@/lib/env", () => ({
  readServerEnvironment: () => ({
    NEXT_PUBLIC_SITE_URL: "http://localhost",
    DOWNLOAD_PRINCIPAL_HMAC_SECRET: "test-secret",
  }),
}));
vi.mock("@/lib/download/principal", () => ({
  createGuestToken: () => "guest-token",
  GUEST_DOWNLOAD_COOKIE: "wf_guest_download",
  GUEST_DOWNLOAD_COOKIE_MAX_AGE: 2_592_000,
  guestPrincipalHash: () => `v1:${"a".repeat(64)}`,
}));
vi.mock("@/lib/download/filename", () => ({
  safeDownloadFilename: (title: string) => `${title.replaceAll(" ", "-")}.png`,
}));
vi.mock("@/lib/wraps/problem", () => ({
  wrapProblem: (
    status: number,
    code: string,
    problem: string,
    rule: string,
    nextAction: string,
  ) =>
    new Response(
      JSON.stringify({ error: { code, problem, rule, nextAction } }),
      {
        status,
        headers: { "content-type": "application/json" },
      },
    ),
}));

import { POST } from "./route";

const prepared = {
  wrap_id: "30000000-0000-0000-0000-000000000001",
  title: "Night Drive",
  template_variant_name: "Cybertruck",
  template_variant_key: "cybertruck",
  vehicle_model_name: "Cybertruck",
  width_px: 1024,
  height_px: 768,
  verified_at: "2026-08-09",
  availability_caveat: "Vehicle caveat",
  bucket_id: "wrap-originals",
  object_key: "owner/revision/original.png",
  byte_size: 123,
  sha256: "a".repeat(64),
};

describe("POST /api/wraps/[slug]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminRpc.mockReset();
    mocks.createAdmin.mockReset();
    mocks.createSigned.mockReset();
    mocks.createServer.mockResolvedValue({});
    mocks.readProfileAccess.mockResolvedValue({ status: "guest" });
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => undefined) });
    mocks.createSigned.mockResolvedValue({
      data: { signedUrl: "http://storage.test/signed" },
      error: null,
    });
    mocks.createAdmin.mockReturnValue({
      rpc: mocks.adminRpc,
      storage: {
        from: vi.fn(() => ({ createSignedUrl: mocks.createSigned })),
      },
    });
    mocks.adminRpc
      .mockResolvedValueOnce({ data: [prepared], error: null })
      .mockResolvedValueOnce({
        data: [
          { event_id: "40000000-0000-0000-0000-000000000001", counted: true },
        ],
        error: null,
      });
  });

  it("signs only the private Original object, records one Guest event, and sets a 30-day cookie", async () => {
    const response = await POST(
      new Request("http://localhost", { method: "POST" }),
      {
        params: Promise.resolve({ slug: "night-drive-abc123" }),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createSigned).toHaveBeenCalledWith(prepared.object_key, 60, {
      download: "Night-Drive.png",
    });
    const body = await response.json();
    expect(body).toMatchObject({
      downloadUrl: "http://storage.test/signed",
      filename: "Night-Drive.png",
      counted: true,
      templateVariant: { key: "cybertruck", widthPx: 1024, heightPx: 768 },
    });
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(
      1,
      "prepare_original_download",
      {
        p_slug: "night-drive-abc123",
        p_user_id: null,
      },
    );
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(
      2,
      "record_original_download",
      expect.objectContaining({
        p_user_id: null,
        p_wrap_id: prepared.wrap_id,
        p_guest_principal_hash: expect.stringMatching(/^v1:[0-9a-f]{64}$/),
      }),
    );
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Max-Age=2592000/i);
  });

  it("does not record an event when Storage cannot issue the signed URL", async () => {
    mocks.createAdmin.mockReturnValueOnce({
      rpc: mocks.adminRpc,
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn(async () => ({
            data: null,
            error: new Error("storage down"),
          })),
        })),
      },
    });
    const response = await POST(
      new Request("http://localhost", { method: "POST" }),
      {
        params: Promise.resolve({ slug: "night-drive-abc123" }),
      },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("WF-DOWNLOAD-STORAGE");
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
  });

  it("uses canonical Auth identity without issuing a Guest cookie", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    const response = await POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ slug: "night-drive-abc123" }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(
      2,
      "record_original_download",
      expect.objectContaining({
        p_user_id: "20000000-0000-0000-0000-000000000001",
        p_guest_principal_hash: null,
      }),
    );
  });

  it("maps an uncertain database record failure without exposing the signed URL", async () => {
    mocks.adminRpc.mockReset();
    mocks.adminRpc
      .mockResolvedValueOnce({ data: [prepared], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "database down" },
      });
    const response = await POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ slug: "night-drive-abc123" }) },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("WF-DOWNLOAD-DATABASE");
  });

  it("rejects malformed slugs before creating a client or grant", async () => {
    const response = await POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ slug: "../private" }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("returns a stable database error when Profile access cannot be read", async () => {
    mocks.readProfileAccess.mockRejectedValue(new Error("profile RPC down"));
    const response = await POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ slug: "night-drive-abc123" }) },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("WF-DOWNLOAD-DATABASE");
  });

  it("rejects a cross-site POST before creating a grant", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
      { params: Promise.resolve({ slug: "night-drive-abc123" }) },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("WF-DOWNLOAD-CSRF");
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });
});
