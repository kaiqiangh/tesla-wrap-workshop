import { describe, expect, it } from "vitest";

import { inspectPngHeader, preflightUpload } from "./preflight";

const variants = [
  ["model3", 1024, 1024],
  ["model3-2024-base", 1024, 1024],
  ["model3-2024-performance", 1024, 1024],
  ["modely", 1024, 1024],
  ["modely-2025-base", 1024, 1024],
  ["modely-2025-premium", 1024, 1024],
  ["modely-2025-performance", 1024, 1024],
  ["modely-l", 1024, 1024],
  ["models-2021", 1024, 1024],
  ["models-2025-plaid", 1024, 1024],
  ["modelx-2021", 1024, 1024],
  ["cybertruck", 1024, 768],
] as const;

describe("PNG client preflight", () => {
  it.each(variants)("accepts the %s catalog dimensions", (_, width, height) => {
    expect(
      preflightUpload(
        {
          name: "art.png",
          type: "image/png",
          size: 80,
          bytes: png(width, height),
        },
        { width, height, maxBytes: 1_000_000 },
      ),
    ).toEqual({ ok: true, width, height });
  });

  it("rejects Cybertruck's square lookalike with a measured failure", () => {
    expect(
      preflightUpload(
        {
          name: "truck.png",
          type: "image/png",
          size: 80,
          bytes: png(1024, 1024),
        },
        { width: 1024, height: 768, maxBytes: 1_000_000 },
      ),
    ).toMatchObject({
      ok: false,
      code: "WF-UPLOAD-DIMENSIONS",
      measured: "1024×1024",
    });
  });

  it.each([
    [
      { name: "art.jpg", type: "image/png", size: 80, bytes: png(1, 1) },
      "WF-UPLOAD-EXTENSION",
    ],
    [
      { name: "art.png", type: "image/jpeg", size: 80, bytes: png(1, 1) },
      "WF-UPLOAD-MIME",
    ],
    [
      { name: "art.png", type: "image/png", size: 1_000_001, bytes: png(1, 1) },
      "WF-UPLOAD-SIZE",
    ],
    [
      { name: "art.png", type: "image/png", size: 8, bytes: new Uint8Array(8) },
      "WF-UPLOAD-READ",
    ],
  ])("rejects preflight boundary failures", (file, code) => {
    expect(
      preflightUpload(file, { width: 1, height: 1, maxBytes: 1_000_000 }),
    ).toMatchObject({ ok: false, code });
  });

  it("rejects corrupt or implausibly large PNG headers", () => {
    expect(() => inspectPngHeader(png(100_000, 100_000))).toThrow(
      "pixel limit",
    );
  });
});

function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
