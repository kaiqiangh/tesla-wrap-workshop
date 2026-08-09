import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { finalizePng } from "./image";

const variants = [
  ["Model 3", 1024, 1024],
  ["Model 3 (2024+) Standard & Premium", 1024, 1024],
  ["Model 3 (2024+) Performance", 1024, 1024],
  ["Model Y", 1024, 1024],
  ["Model Y (2025+) Standard", 1024, 1024],
  ["Model Y (2025+) Premium", 1024, 1024],
  ["Model Y (2025+) Performance", 1024, 1024],
  ["Model Y L", 1024, 1024],
  ["Model S (2021+)", 1024, 1024],
  ["Model S (2025+) Plaid", 1024, 1024],
  ["Model X (2021+)", 1024, 1024],
  ["Cybertruck", 1024, 768],
] as const;

describe("authoritative PNG finalization", () => {
  it.each(variants)(
    "normalizes %s and creates private display assets",
    async (_, width, height) => {
      const input = await fixture(width, height);
      const result = await finalizePng(input, {
        filename: "wrap.png",
        mimeType: "image/png",
        asserted: true,
        width,
        height,
        maxBytes: 1_000_000,
      });

      expect(result.original).toMatchObject({ width, height });
      expect(result.original.bytes.byteLength).toBeLessThanOrEqual(1_000_000);
      expect(result.original.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.preview.width).toBeLessThanOrEqual(640);
      expect(result.thumbnail.width).toBeLessThanOrEqual(320);
      expect((await sharp(result.original.bytes).metadata()).format).toBe(
        "png",
      );
    },
  );

  it("rejects the Cybertruck square lookalike with no decoder detail", async () => {
    await expect(
      finalizePng(await fixture(1024, 1024), {
        filename: "truck.png",
        mimeType: "image/png",
        asserted: true,
        width: 1024,
        height: 768,
        maxBytes: 1_000_000,
      }),
    ).rejects.toMatchObject({
      code: "WF-UPLOAD-DIMENSIONS",
      measured: "1024×1024",
      rule: "This Template Variant requires exactly 1024×768.",
    });
  });

  it.each([
    ["renamed.jpg", "image/png", true, "WF-UPLOAD-EXTENSION"],
    ["wrap.png", "image/jpeg", true, "WF-UPLOAD-MIME"],
    ["wrap.png", "image/png", false, "WF-UPLOAD-ASSERTION"],
  ])(
    "rejects the server trust boundary",
    async (filename, mimeType, asserted, code) => {
      await expect(
        finalizePng(await fixture(1024, 1024), {
          filename,
          mimeType,
          asserted,
          width: 1024,
          height: 1024,
          maxBytes: 1_000_000,
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it("rejects truncated bytes as a stable decode failure", async () => {
    await expect(
      finalizePng(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        filename: "broken.png",
        mimeType: "image/png",
        asserted: true,
        width: 1024,
        height: 1024,
        maxBytes: 1_000_000,
      }),
    ).rejects.toMatchObject({ code: "WF-UPLOAD-DECODE" });
  });

  it("enforces the authoritative input-byte ceiling before decode", async () => {
    await expect(
      finalizePng(new Uint8Array(1_000_001), rules()),
    ).rejects.toMatchObject({
      code: "WF-UPLOAD-SIZE",
      measured: "1000001 bytes",
    });
  });

  it("enforces PNG magic bytes independently from extension and MIME", async () => {
    await expect(
      finalizePng(new Uint8Array(24), rules()),
    ).rejects.toMatchObject({ code: "WF-UPLOAD-SIGNATURE" });
  });

  it("rejects decoded pixel counts above the bounded envelope", async () => {
    await expect(
      finalizePng(await fixture(2048, 1024), rules()),
    ).rejects.toMatchObject({ code: "WF-UPLOAD-DECODE" });
  });

  it("enforces the normalized-output ceiling after metadata removal", async () => {
    const raw = Buffer.alloc(1024 * 1024 * 3);
    let random = 123456789;
    for (let pixel = 0; pixel < 1024 * 1024; pixel += 1) {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      const value = (random >>> 0) % 64;
      raw[pixel * 3] = value;
      raw[pixel * 3 + 1] = (value * 73) % 256;
      raw[pixel * 3 + 2] = (value * 151) % 256;
    }
    const compactPaletteInput = await sharp(raw, {
      raw: { width: 1024, height: 1024, channels: 3 },
    })
      .png({ palette: true, colours: 64 })
      .toBuffer();
    expect(compactPaletteInput.byteLength).toBeLessThan(1_000_000);
    await expect(
      finalizePng(compactPaletteInput, rules()),
    ).rejects.toMatchObject({ code: "WF-UPLOAD-NORMALIZED-SIZE" });
  });

  it("preserves rendered RGBA pixels while stripping nonessential metadata", async () => {
    const input = await sharp({
      create: {
        width: 1024,
        height: 768,
        channels: 4,
        background: { r: 19, g: 71, b: 211, alpha: 0.43 },
      },
    })
      .withMetadata({ orientation: 1 })
      .png()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await finalizePng(input, {
      ...rules(),
      width: 1024,
      height: 768,
    });
    expect(
      await sharp(result.original.bytes).ensureAlpha().raw().toBuffer(),
    ).toEqual(await sharp(input).ensureAlpha().raw().toBuffer());
    const normalizedMetadata = await sharp(result.original.bytes).metadata();
    expect(normalizedMetadata.exif).toBeUndefined();
    expect(normalizedMetadata.icc).toBeUndefined();
  }, 15_000);
});

async function fixture(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 38, g: 247, b: 185, alpha: 0.7 },
    },
  })
    .png()
    .toBuffer();
}

function rules() {
  return {
    filename: "wrap.png",
    mimeType: "image/png",
    asserted: true,
    width: 1024,
    height: 1024,
    maxBytes: 1_000_000,
  };
}
