import { describe, expect, it, vi } from "vitest";

import { getDiscoveryWraps, getPublicVehicleModel } from "./discovery";

function client(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as never;
}

describe("discovery read boundary", () => {
  it("distinguishes empty results from RPC failures", async () => {
    expect(await getDiscoveryWraps(client([]), "NEWEST")).toEqual({
      status: "empty",
      wraps: [],
    });
    expect(
      await getDiscoveryWraps(client(null, new Error("offline")), "NEWEST"),
    ).toEqual({ status: "error", wraps: [] });
  });

  it("passes bounded model arguments and maps model absence", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ slug: "model-3", display_name: "Model 3", sort_order: 1 }],
      error: null,
    });
    const modelClient = { rpc } as never;
    await getDiscoveryWraps(modelClient, "MODEL", {
      modelSlug: "model-3",
      limit: 24,
    });
    expect(rpc).toHaveBeenCalledWith("get_discovery_wraps", {
      p_kind: "MODEL",
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
});
