import { createHmac } from "node:crypto";

export const SEARCH_SESSION_COOKIE = "wf_search_session";

export function hmacPrincipal(
  secret: string,
  kind: "actor" | "email" | "network" | "search",
  value: string,
) {
  const digest = createHmac("sha256", secret).update(value).digest("hex");
  return `v2:${kind}:${digest}`;
}

// Trust model: exactly one trusted edge (Vercel) sets x-real-ip and prepends
// the original client address to x-forwarded-for, so the FIRST forwarded
// entry is the client; later entries are proxy hops an attacker can seed.
export function headerNetworkPrincipal(headers: Headers) {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for");
  const addresses = forwarded
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return addresses?.at(0) ?? "unknown";
}

export function requestNetworkPrincipal(request: Request) {
  return headerNetworkPrincipal(request.headers);
}

// Anonymous rate-limit principal: the session cookie when present, otherwise
// the network address — never a per-request random value (which would let
// cookieless clients rotate past every limit) and never one shared bucket.
export function searchPrincipal(
  secret: string,
  session: string | null,
  network: string,
) {
  return session
    ? hmacPrincipal(secret, "search", session)
    : hmacPrincipal(secret, "network", network);
}
