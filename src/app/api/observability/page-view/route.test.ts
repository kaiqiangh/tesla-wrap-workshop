import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHmac } from "node:crypto";

const adminMocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  readServerEnvironment: vi.fn(() => ({
    DOWNLOAD_PRINCIPAL_HMAC_SECRET:
      "page-view-route-test-secret-0123456789012345",
  })),
}));
vi.mock("@/lib/observability", () => ({
  observeRoute: (
    request: Request,
    _action: string,
    _targetType: string,
    handler: (operation: never) => Promise<Response>,
  ) =>
    handler({
      correlationId: "test-correlation",
      action: "PAGE_VIEW",
      targetType: "DISCOVERY",
      startedAt: Date.now(),
    } as never),
  recordCoreLoopEvent: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: adminMocks.createAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  })),
}));

import { POST } from "./route";

function rpcCapture() {
  return vi.fn().mockResolvedValue({ data: null, error: null });
}

function pageViewRequest(headers: Record<string, string>) {
  return new Request("http://localhost/api/observability/page-view", {
    method: "POST",
    headers,
  });
}

describe("page view rate-limit principals", () => {
  let consumePageViewLimit: ReturnType<typeof rpcCapture>;

  beforeEach(() => {
    consumePageViewLimit = rpcCapture();
    adminMocks.createAdmin.mockReturnValue({
      rpc: consumePageViewLimit,
    });
  });

  it("keys cookieless page views by network, never the retired shared bucket", async () => {
    const response = await POST(
      pageViewRequest({ "x-real-ip": "192.0.2.10" }),
    );
    expect(response.status).toBe(200);
    expect(consumePageViewLimit.mock.calls[0][0]).toBe(
      "consume_page_view_limit",
    );
    const { p_session_principal } = consumePageViewLimit.mock.calls[0][1] as {
      p_session_principal: string;
    };
    expect(p_session_principal).toMatch(/^v2:network:[0-9a-f]{64}$/);
    const missingBucket =
      "v2:search:" +
      createHmac("sha256", "page-view-route-test-secret-0123456789012345")
        .update("missing")
        .digest("hex");
    expect(p_session_principal).not.toBe(missingBucket);
    expect(consumePageViewLimit.mock.calls[0][1]).toMatchObject({
      p_network_principal: expect.stringMatching(/^v2:network:[0-9a-f]{64}$/),
    });
  });

  it("keeps cookie-bearing page views keyed on the session value", async () => {
    await POST(
      pageViewRequest({
        "x-real-ip": "192.0.2.10",
        cookie: "wf_search_session=sess-123",
      }),
    );
    const { p_session_principal } = consumePageViewLimit.mock.calls[0][1] as {
      p_session_principal: string;
    };
    expect(p_session_principal).toMatch(/^v2:search:[0-9a-f]{64}$/);
  });
});