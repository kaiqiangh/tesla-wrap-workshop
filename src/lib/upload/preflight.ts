export const MAX_PNG_PIXELS = 1_048_576;

type UploadLike = {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
};

type VariantLimit = { width: number; height: number; maxBytes: number };

export type UploadProblem = {
  ok: false;
  code:
    | "WF-UPLOAD-EXTENSION"
    | "WF-UPLOAD-MIME"
    | "WF-UPLOAD-SIZE"
    | "WF-UPLOAD-READ"
    | "WF-UPLOAD-DIMENSIONS";
  problem: string;
  rule: string;
  nextAction: string;
  measured: string;
};

export function inspectPngHeader(bytes: Uint8Array) {
  if (bytes.byteLength < 24) throw new Error("PNG header is truncated");
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) {
    throw new Error("PNG signature is invalid");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(8) !== 13 ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  ) {
    throw new Error("PNG header is invalid");
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width * height > MAX_PNG_PIXELS) {
    throw new Error("PNG pixel limit exceeded");
  }
  return { width, height };
}

export function preflightUpload(
  file: UploadLike,
  variant: VariantLimit,
): { ok: true; width: number; height: number } | UploadProblem {
  if (!file.name.toLowerCase().endsWith(".png")) {
    return failure(
      "WF-UPLOAD-EXTENSION",
      file.name,
      "The filename must end in .png.",
      "Choose the exported PNG file.",
    );
  }
  if (file.type !== "image/png") {
    return failure(
      "WF-UPLOAD-MIME",
      file.type || "no MIME type",
      "The declared file type must be image/png.",
      "Export the artwork as PNG and choose it again.",
    );
  }
  if (file.size > variant.maxBytes) {
    return failure(
      "WF-UPLOAD-SIZE",
      `${file.size} bytes`,
      `The file must be at most ${variant.maxBytes} bytes.`,
      "Reduce the lossless PNG size and try a fresh upload.",
    );
  }
  let measured: { width: number; height: number };
  try {
    measured = inspectPngHeader(file.bytes);
  } catch {
    return failure(
      "WF-UPLOAD-READ",
      "Unreadable PNG header",
      "The file must be a readable PNG.",
      "Export a valid PNG and choose it again.",
    );
  }
  if (measured.width !== variant.width || measured.height !== variant.height) {
    return failure(
      "WF-UPLOAD-DIMENSIONS",
      `${measured.width}×${measured.height}`,
      `This Template Variant requires exactly ${variant.width}×${variant.height}.`,
      "Export from the selected official template at its original dimensions.",
    );
  }
  return { ok: true, ...measured };
}

function failure(
  code: UploadProblem["code"],
  measured: string,
  rule: string,
  nextAction: string,
): UploadProblem {
  return { ok: false, code, problem: measured, measured, rule, nextAction };
}
