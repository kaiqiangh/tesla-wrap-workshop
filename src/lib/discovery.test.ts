import { describe, expect, it, vi } from "vitest";

import {
  getDiscoveryWraps,
  getPublicVehicleModel,
  searchDiscoveryWraps,
} from "./discovery";

function client(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as never;
}

const emptySearch = {
  items: [],
  next_cursor: null,
  calculated_at: "2026-08-11T00:00:00Z",
  ranking_status: "LIVE",
};

describe("discovery read boundary", () => {
  it("distinguishes empty results from RPC failures", async () => {
    expect(await getDiscoveryWraps(client(emptySearch), "NEWEST")).toEqual({
      status: "empty",
      wraps: [],
      calculatedAt: "2026-08-11T00:00:00Z",
      rankingStatus: "LIVE",
    });
    expect(
      await getDiscoveryWraps(client(null, new Error("offline")), "NEWEST"),
    ).toEqual({ status: "error", wraps: [] });
  });

  it("passes bounded model arguments and maps model absence", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        items: [],
        next_cursor: null,
        calculated_at: "2026-08-11T00:00:00Z",
        ranking_status: "LIVE",
      },
      error: null,
    });
    const modelClient = { rpc } as never;
    await getDiscoveryWraps(modelClient, "MODEL", {
      modelSlug: "model-3",
      limit: 24,
    });
    expect(rpc).toHaveBeenCalledWith("search_discovery_wraps", {
      p_sort: "NEWEST",
      p_model_slug: "model-3",
      p_limit: 24,
    });

    expect(await getPublicVehicleModel(client([]), "missing-model")).toEqual({
      status: "missing",
    });
    expect(
      await getPublicVehicleModel(
        client(null, new Error("offline")),
        "model-3",
      ),
    ).toEqual({ status: "error" });
  });

  it("maps the JSON search contract and forwards opaque cursors for Load More", async () => {
    const item = { id: "wrap-1", slug: "wrap-1", title: "First" };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          items: [item],
          next_cursor: "cursor-1",
          calculated_at: "2026-08-09T00:00:00Z",
          ranking_status: "LIVE",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ ...item, id: "wrap-2", slug: "wrap-2", title: "Second" }],
          next_cursor: null,
          calculated_at: "2026-08-09T00:00:00Z",
          ranking_status: "LIVE",
        },
        error: null,
      });
    const searchClient = { rpc } as never;
    expect(
      await searchDiscoveryWraps(searchClient, { q: "Tesla" }),
    ).toMatchObject({
      status: "ok",
      wraps: [item],
      nextCursor: "cursor-1",
    });
    expect(
      await searchDiscoveryWraps(searchClient, {
        q: "Tesla",
        cursor: "cursor-1",
      }),
    ).toMatchObject({
      status: "ok",
      wraps: [{ id: "wrap-2" }],
      nextCursor: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "search_discovery_wraps", {
      p_q: "Tesla",
      p_sort: "NEWEST",
      p_limit: 24,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "search_discovery_wraps", {
      p_q: "Tesla",
      p_sort: "NEWEST",
      p_cursor: "cursor-1",
      p_limit: 24,
    });

    expect(
      await searchDiscoveryWraps(client(null, new Error("offline"))),
    ).toEqual({
      status: "error",
      wraps: [],
      nextCursor: null,
    });
    expect(
      await searchDiscoveryWraps(
        client(null, { message: "invalid_discovery_cursor" }),
      ),
    ).toEqual({ status: "invalid", wraps: [], nextCursor: null });
  });

  it("falls back to Newest when a live Trending query fails", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error("ranking down") })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "newest-1" }],
          next_cursor: null,
          calculated_at: "2026-08-11T00:00:00Z",
          ranking_status: "LIVE",
        },
        error: null,
      });
    const result = await searchDiscoveryWraps({ rpc } as never, {
      sort: "TRENDING",
    });
    expect(result).toMatchObject({
      status: "ok",
      rankingStatus: "FALLBACK_NEWEST",
      wraps: [{ id: "newest-1" }],
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "search_discovery_wraps", {
      p_sort: "NEWEST",
      p_limit: 24,
    });
  });

  it("does not turn a malformed search payload into an empty catalog", async () => {
    expect(
      await searchDiscoveryWraps(client({ items: [], ranking_status: "LIVE" })),
    ).toEqual({ status: "error", wraps: [], nextCursor: null });
  });

  it("preserves search rate limits as a distinct state", async () => {
    expect(
      await searchDiscoveryWraps(
        client(null, { message: "search_rate_limited" }),
      ),
    ).toEqual({ status: "rate_limited", wraps: [], nextCursor: null });
  });
});
