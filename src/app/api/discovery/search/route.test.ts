import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@/lib/discovery", () => ({ searchDiscoveryWraps: mocks.search }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServer,
}));

import { GET } from "./route";

describe("GET /api/discovery/search", () => {
  it("rejects invalid cursors before the database", async () => {
    const response = await GET(
      new Request("http://localhost/api/discovery/search?cursor=bad"),
    );
    expect(response.status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("maps the search bucket to HTTP 429 with Retry-After", async () => {
    mocks.createServer.mockResolvedValue({});
    mocks.search.mockResolvedValue({
      status: "rate_limited",
      wraps: [],
      nextCursor: null,
    });
    const response = await GET(
      new Request("http://localhost/api/discovery/search?q=tesla"),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("returns the typed search result", async () => {
    mocks.createServer.mockResolvedValue({});
    mocks.search.mockResolvedValue({
      status: "empty",
      wraps: [],
      nextCursor: null,
      calculatedAt: "2026-08-11T00:00:00Z",
      rankingStatus: "LIVE",
    });
    const response = await GET(
      new Request("http://localhost/api/discovery/search"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "empty" });
  });
});
