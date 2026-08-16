import { describe, expect, it, vi } from "vitest";

import { persistAssetRevision, type AssetObject } from "./persist";

const assets: AssetObject[] = [
  {
    bucket: "wrap-originals",
    key: "owner/revision/original.png",
    bytes: Buffer.from("original"),
  },
  {
    bucket: "wrap-derived",
    key: "owner/revision/preview.png",
    bytes: Buffer.from("preview"),
  },
  {
    bucket: "wrap-derived",
    key: "owner/revision/thumbnail.png",
    bytes: Buffer.from("thumbnail"),
  },
];

describe("cross-system finalization recovery", () => {
  it("removes partial objects and records a recoverable Storage failure", async () => {
    const store = vi.fn(async (asset: AssetObject) => {
      if (asset.key.endsWith("preview.png"))
        throw new Error("injected Storage failure");
    });
    const remove = vi.fn(async () => true);
    const fail = vi.fn(async () => true);

    expect(
      await persistAssetRevision({
        assets,
        store,
        complete: vi.fn(async () => "complete" as const),
        remove,
        fail,
        removeStaging: vi.fn(async () => true),
      }),
    ).toBe("WF-UPLOAD-STORAGE");
    expect(remove).toHaveBeenCalledWith([assets[0]]);
    expect(fail).toHaveBeenCalledWith("WF-UPLOAD-STORAGE");
  });

  it("removes all objects and records a recoverable database failure", async () => {
    const remove = vi.fn(async () => true);
    const fail = vi.fn(async () => true);

    expect(
      await persistAssetRevision({
        assets,
        store: vi.fn(async () => undefined),
        complete: vi.fn(async () => "failed" as const),
        remove,
        fail,
        removeStaging: vi.fn(async () => true),
      }),
    ).toBe("WF-UPLOAD-DATABASE");
    expect(remove).toHaveBeenCalledWith(assets);
    expect(fail).toHaveBeenCalledWith("WF-UPLOAD-DATABASE");
  });

  it("removes staging only after all assets and metadata complete", async () => {
    const removeStaging = vi.fn(async () => undefined);
    expect(
      await persistAssetRevision({
        assets,
        store: vi.fn(async () => undefined),
        complete: vi.fn(async () => "complete" as const),
        remove: vi.fn(async () => true),
        fail: vi.fn(async () => true),
        removeStaging: async () => {
          await removeStaging();
          return true;
        },
      }),
    ).toBe("READY");
    expect(removeStaging).toHaveBeenCalledOnce();
  });

  it("retains objects when the database outcome is ambiguous", async () => {
    const remove = vi.fn(async () => true);
    const fail = vi.fn(async () => true);
    expect(
      await persistAssetRevision({
        assets,
        store: vi.fn(async () => undefined),
        complete: vi.fn(async () => "unknown" as const),
        remove,
        fail,
        removeStaging: vi.fn(async () => true),
      }),
    ).toBe("WF-UPLOAD-DATABASE-UNKNOWN");
    expect(remove).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("reports cleanup failure instead of hiding an orphaned object", async () => {
    const fail = vi.fn(async () => true);
    expect(
      await persistAssetRevision({
        assets,
        store: vi.fn(async () => undefined),
        complete: vi.fn(async () => "failed" as const),
        remove: vi.fn(async () => false),
        fail,
        removeStaging: vi.fn(async () => true),
      }),
    ).toBe("WF-UPLOAD-CLEANUP");
    expect(fail).toHaveBeenCalledWith("WF-UPLOAD-CLEANUP");
  });
});
