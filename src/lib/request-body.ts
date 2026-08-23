// Shared JSON body preflight (WU-06): one parse path for every mutating
// route. Rejects wrong Content-Type and oversized bodies before buffering,
// then parses once. Routes keep their own 400 problem helpers.
const DEFAULT_MAX_BYTES = 64 * 1024;

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false };

export async function readJsonBody(
  request: Request,
  options: { maxBytes?: number } = {},
): Promise<JsonBodyResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const contentType = request.headers.get("content-type");
  if (
    contentType &&
    !contentType.toLowerCase().split(";")[0]?.trim().startsWith("application/json")
  ) {
    return { ok: false };
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false };
  }
  try {
    const body = await request.json();
    if (body === null || typeof body !== "object") return { ok: false };
    return { ok: true, body };
  } catch {
    return { ok: false };
  }
}