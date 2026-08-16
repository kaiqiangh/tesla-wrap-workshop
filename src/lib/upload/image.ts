import { createHash } from "node:crypto";

import sharp, { type Metadata } from "sharp";

import { MAX_PNG_PIXELS } from "./preflight";

type Rules = {
  filename: string;
  mimeType: string;
  asserted: boolean;
  width: number;
  height: number;
  maxBytes: number;
};

type RenderedPng = {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
};

export class UploadValidationError extends Error {
  constructor(
    readonly code: string,
    readonly measured: string,
    readonly rule: string,
    readonly nextAction: string,
  ) {
    super(code);
  }
}

export async function finalizePng(input: Uint8Array, rules: Rules) {
  if (!rules.filename.toLowerCase().endsWith(".png")) {
    fail(
      "WF-UPLOAD-EXTENSION",
      rules.filename,
      "The filename must end in .png.",
      "Choose the exported PNG file.",
    );
  }
  if (rules.mimeType !== "image/png") {
    fail(
      "WF-UPLOAD-MIME",
      rules.mimeType || "no MIME type",
      "The declared file type must be image/png.",
      "Export the artwork as PNG and start a fresh upload.",
    );
  }
  if (!rules.asserted) {
    fail(
      "WF-UPLOAD-ASSERTION",
      "Not confirmed",
      "You must confirm that you used the selected official template.",
      "Confirm the template assertion and start a fresh upload.",
    );
  }
  if (input.byteLength > rules.maxBytes) {
    fail(
      "WF-UPLOAD-SIZE",
      `${input.byteLength} bytes`,
      `The staged PNG must be at most ${rules.maxBytes} bytes.`,
      "Reduce the lossless PNG size and start a fresh upload.",
    );
  }
  if (!hasPngSignature(input)) {
    fail(
      "WF-UPLOAD-SIGNATURE",
      "Invalid PNG signature",
      "The staged bytes must begin with the PNG signature.",
      "Export a valid PNG and start a fresh upload.",
    );
  }

  let decoded: Buffer;
  let metadata: Metadata;
  try {
    const image = sharp(input, {
      failOn: "warning",
      limitInputPixels: MAX_PNG_PIXELS,
      sequentialRead: true,
    });
    metadata = await image.metadata();
    decoded = await image.ensureAlpha().raw().toBuffer();
  } catch {
    fail(
      "WF-UPLOAD-DECODE",
      "Unreadable PNG pixels",
      `The PNG must decode safely within ${MAX_PNG_PIXELS} pixels.`,
      "Export a valid PNG and start a fresh upload.",
    );
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (metadata.format !== "png") {
    fail(
      "WF-UPLOAD-SIGNATURE",
      metadata.format ?? "unknown format",
      "The decoded image must be PNG.",
      "Export a valid PNG and start a fresh upload.",
    );
  }
  if (width !== rules.width || height !== rules.height) {
    fail(
      "WF-UPLOAD-DIMENSIONS",
      `${width}×${height}`,
      `This Template Variant requires exactly ${rules.width}×${rules.height}.`,
      "Export from the selected official template at its original dimensions.",
    );
  }

  const source = sharp(decoded, { raw: { width, height, channels: 4 } });
  const originalBytes = await source
    .clone()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  if (originalBytes.byteLength > rules.maxBytes) {
    fail(
      "WF-UPLOAD-NORMALIZED-SIZE",
      `${originalBytes.byteLength} bytes`,
      `The normalized PNG must be at most ${rules.maxBytes} bytes.`,
      "Simplify the artwork or reduce lossless PNG complexity and start a fresh upload.",
    );
  }
  const previewBytes = await source
    .clone()
    .resize({
      width: 640,
      height: 640,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const thumbnailBytes = await source
    .clone()
    .resize({
      width: 320,
      height: 320,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return {
    original: rendered(originalBytes, width, height),
    preview: rendered(previewBytes, ...fit(width, height, 640)),
    thumbnail: rendered(thumbnailBytes, ...fit(width, height, 320)),
  };
}

function hasPngSignature(bytes: Uint8Array) {
  return [137, 80, 78, 71, 13, 10, 26, 10].every(
    (value, index) => bytes[index] === value,
  );
}

function rendered(bytes: Buffer, width: number, height: number): RenderedPng {
  return {
    bytes,
    width,
    height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function fit(width: number, height: number, edge: number): [number, number] {
  const ratio = Math.min(1, edge / width, edge / height);
  return [Math.round(width * ratio), Math.round(height * ratio)];
}

function fail(
  code: string,
  measured: string,
  rule: string,
  nextAction: string,
): never {
  throw new UploadValidationError(code, measured, rule, nextAction);
}
