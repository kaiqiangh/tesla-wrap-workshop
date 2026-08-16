import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  readEnvironment: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  readServerEnvironment: mocks.readEnvironment,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));

import { GET } from "./route";

describe("GET /api/discovery/ranking/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readEnvironment.mockReturnValue({
      WRAPFORGE_ENVIRONMENT: "local",
      CRON_SECRET: "cron-secret",
    });
    mocks.rpc.mockResolvedValue({
      data: "2026-08-11T03:00:00.000Z",
      error: null,
    });
    mocks.createAdmin.mockReturnValue({ rpc: mocks.rpc });
  });

  it("refreshes through the service-role RPC locally", async () => {
    const response = await GET(
      new Request("http://localhost/api/discovery/ranking/refresh", {
        headers: {
          "x-correlation-id": "11111111-1111-4111-8111-111111111111",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(await response.json()).toEqual({
      calculatedAt: "2026-08-11T03:00:00.000Z",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("refresh_discovery_ranking");
  });

  it("requires the Vercel Cron bearer secret outside local mode", async () => {
    mocks.readEnvironment.mockReturnValue({
      WRAPFORGE_ENVIRONMENT: "production",
      CRON_SECRET: "cron-secret",
    });
    const response = await GET(
      new Request("https://wrapforge.example/api/discovery/ranking/refresh"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts the Vercel Cron bearer secret outside local mode", async () => {
    mocks.readEnvironment.mockReturnValue({
      WRAPFORGE_ENVIRONMENT: "development",
      CRON_SECRET: "cron-secret",
    });
    const response = await GET(
      new Request(
        "https://preview.wrapforge.example/api/discovery/ranking/refresh",
        {
          headers: { authorization: "Bearer cron-secret" },
        },
      ),
    );
    expect(response.status).toBe(200);
  });

  it("returns a stable outage when the ranking refresh fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("offline") });
    const response = await GET(
      new Request("http://localhost/api/discovery/ranking/refresh"),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("ranking_refresh_failed");
  });

  it("maps thrown ranking dependencies to the stable outage", async () => {
    mocks.rpc.mockRejectedValue(new Error("offline"));
    const response = await GET(
      new Request("http://localhost/api/discovery/ranking/refresh", {
        headers: {
          "x-correlation-id": "22222222-2222-4222-8222-222222222222",
        },
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("x-correlation-id")).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect((await response.json()).error.code).toBe("ranking_refresh_failed");
  });

  it("maps environment failures to the stable outage", async () => {
    mocks.readEnvironment.mockImplementation(() => {
      throw new Error("invalid environment");
    });
    const response = await GET(
      new Request("http://localhost/api/discovery/ranking/refresh"),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("ranking_refresh_failed");
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });
});
