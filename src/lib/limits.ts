import { createHmac } from "node:crypto";

export const SEARCH_SESSION_COOKIE = "wf_search_session";

export function hmacPrincipal(
  secret: string,
  kind: "email" | "network" | "search",
  value: string,
) {
  const digest = createHmac("sha256", secret).update(value).digest("hex");
  return `v2:${kind}:${digest}`;
}

export function requestNetworkPrincipal(request: Request) {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for");
  const addresses = forwarded
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return addresses?.at(-1) ?? "unknown";
}
