import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  exceedsAvatarRequestLimit,
  MAX_AVATAR_REQUEST_BYTES,
  normalizeAvatar,
} from "./avatar";

async function image(format: "png" | "jpeg" | "webp") {
  return sharp({
    create: { width: 4, height: 3, channels: 4, background: "#63f5d1" },
  })
    .toFormat(format)
    .toBuffer();
}

describe("normalizeAvatar", () => {
  it.each([
    [null, false],
    [String(MAX_AVATAR_REQUEST_BYTES), false],
    [String(MAX_AVATAR_REQUEST_BYTES + 1), true],
    ["not-a-length", false],
  ])("guards declared request size %s", (contentLength, expected) => {
    expect(exceedsAvatarRequestLimit(contentLength)).toBe(expected);
  });

  it("accepts supported media and emits a PNG derivative", async () => {
    const result = await normalizeAvatar(await image("jpeg"), "image/jpeg");
    expect(result.width).toBe(4);
    expect(result.height).toBe(3);
    await expect(sharp(result.derived).metadata()).resolves.toMatchObject({
      format: "png",
    });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["image/gif", Buffer.from("gif")],
    ["image/png", Buffer.from("truncated")],
  ])("rejects unsafe input (%s)", async (mime, bytes) => {
    await expect(normalizeAvatar(bytes, mime)).rejects.toThrow();
  });
});
