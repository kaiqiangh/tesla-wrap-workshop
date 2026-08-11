import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
}));

vi.mock("./supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));

import {
  beginOperation,
  finishOperation,
  observeRoute,
  recordCoreLoopEvent,
} from "./observability";

describe("server observability", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("WRAPFORGE_ENVIRONMENT", "local");
    vi.stubEnv("DOWNLOAD_PRINCIPAL_HMAC_SECRET", "a".repeat(32));
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
  });

  it("adds a correlation header and logs only the stable error code", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const request = new Request("http://localhost/api/test", {
      headers: { "x-correlation-id": "10000000-0000-4000-8000-000000000001" },
    });
    const context = beginOperation(request, "DOWNLOAD", "DOWNLOAD");
    const response = await finishOperation(
      new Response(
        JSON.stringify({
          error: {
            code: "WF-DOWNLOAD-DATABASE",
            message: "raw storage key should never be logged",
          },
        }),
        { status: 503 },
      ),
      context,
    );

    expect(response.headers.get("x-correlation-id")).toBe(
      context.correlationId,
    );
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(0);
    const line = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(line).toMatchObject({
      type: "wrapforge.operation",
      correlationId: context.correlationId,
      action: "DOWNLOAD",
      targetType: "DOWNLOAD",
      outcome: "error",
      code: "WF-DOWNLOAD-DATABASE",
      actor: "guest",
    });
    expect(JSON.stringify(line)).not.toContain("raw storage key");
  });

  it("records a durable event through the service-only RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: "10000000-0000-4000-8000-000000000002",
      error: null,
    });
    mocks.createAdmin.mockReturnValue({ rpc });

    await expect(
      recordCoreLoopEvent({
        eventKind: "WRAP_VIEW",
        targetType: "WRAP",
        targetId: "10000000-0000-4000-8000-000000000003",
        outcome: "SUCCESS",
        code: "WRAP_VIEW",
        correlationId: "10000000-0000-4000-8000-000000000004",
      }),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "record_core_loop_event",
      expect.objectContaining({
        p_event_kind: "WRAP_VIEW",
        p_target_type: "WRAP",
        p_code: "WRAP_VIEW",
      }),
    );
  });

  it("maps unexpected route failures to a correlated stable 500", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const request = new Request("http://localhost/api/test");
    const response = await observeRoute(
      request,
      "TEST",
      "AUTH",
      async (): Promise<Response> => {
        throw new Error("raw backend detail");
      },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed right now.",
      },
    });
    expect(String(error.mock.calls[0]?.[0])).not.toContain(
      "raw backend detail",
    );
  });
});
