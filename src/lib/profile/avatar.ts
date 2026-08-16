import { createHash } from "node:crypto";

import sharp, { type Metadata } from "sharp";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_PIXELS = 16_777_216;

export async function normalizeAvatar(input: Buffer, mimeType: string) {
  if (input.byteLength === 0 || input.byteLength > MAX_AVATAR_BYTES) {
    throw new Error("avatar_size");
  }
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(mimeType)) {
    throw new Error("avatar_mime");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_AVATAR_PIXELS,
    }).metadata();
  } catch {
    throw new Error("avatar_decode");
  }
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error("avatar_decode");
  }
  if (!["png", "jpeg", "webp"].includes(metadata.format)) {
    throw new Error("avatar_format");
  }

  let derived: { data: Buffer };
  try {
    derived = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_AVATAR_PIXELS,
    })
      .rotate()
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new Error("avatar_decode");
  }
  const dimensions = await sharp(derived.data).metadata();
  return {
    source: input,
    derived: derived.data,
    width: dimensions.width ?? 0,
    height: dimensions.height ?? 0,
    sha256: createHash("sha256").update(derived.data).digest("hex"),
  };
}
