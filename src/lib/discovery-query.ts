import type { DiscoverySort } from "./discovery";

export const DISCOVERY_SORTS: readonly DiscoverySort[] = [
  "TRENDING",
  "NEWEST",
  "MOST_DOWNLOADED",
];

export type DiscoveryQuery = {
  q?: string;
  model?: string;
  variant?: string;
  sort: DiscoverySort;
  cursor?: string;
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseDiscoveryQuery(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
): DiscoveryQuery | null {
  const get = (key: string) =>
    input instanceof URLSearchParams
      ? (input.get(key) ?? undefined)
      : one(input[key]);
  const q = get("q")?.trim() || undefined;
  const model = get("model")?.trim().toLowerCase() || undefined;
  const variant = get("variant")?.trim().toLowerCase() || undefined;
  const sort = (get("sort")?.trim().toUpperCase() || "NEWEST") as DiscoverySort;
  const rawCursor = get("cursor");
  const cursor = rawCursor?.trim() || undefined;
  if (q && [...q].length > 100) return null;
  if (model && model.length > 100) return null;
  if (variant && variant.length > 100) return null;
  if (!DISCOVERY_SORTS.includes(sort)) return null;
  if (rawCursor !== undefined && !cursor) return null;
  if (cursor && !/^[0-9a-f]{36}$/.test(cursor)) return null;
  return { q, model, variant, sort, cursor };
}

export function discoveryQueryString(query: DiscoveryQuery) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.model) params.set("model", query.model);
  if (query.variant) params.set("variant", query.variant);
  if (query.sort !== "NEWEST") params.set("sort", query.sort);
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}
