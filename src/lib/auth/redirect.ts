export function safeNextPath(candidate: string | null | undefined): string {
  if (
    !candidate?.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return "/";
  }

  const parsed = new URL(candidate, "http://wrapforge.local");
  return `${parsed.pathname}${parsed.search}`;
}

export function authCallbackUrl(siteUrl: string, next?: string): string {
  const callback = new URL("/auth/callback", siteUrl);
  callback.searchParams.set("next", safeNextPath(next));
  return callback.toString();
}
