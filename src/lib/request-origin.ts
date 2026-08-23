// Single source of truth for same-origin checks (WU-12/PR-09). One policy
// for admin mutations, guest downloads, and the proxy mutation guard:
// browsers on another site are rejected; non-browser clients that omit
// Origin pass; present Origins must match the deployment (request Host,
// configured site URL, or the request URL itself).
export function isSameOriginRequest(
  request: Request,
  options: { siteUrl?: string } = {},
): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const trustedHosts = new Set<string>();
  const host = request.headers.get("host");
  if (host) trustedHosts.add(host.toLowerCase());
  if (options.siteUrl) {
    try {
      trustedHosts.add(new URL(options.siteUrl).host.toLowerCase());
    } catch {
      // An unusable siteUrl contributes no trust; Host checks still apply.
    }
  }
  if (trustedHosts.has(originUrl.host.toLowerCase())) return true;
  try {
    return originUrl.origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}