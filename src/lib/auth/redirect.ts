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

const AUTH_ORIGIN_ENV_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).origin;
  } catch {
    return null;
  }
}

export function allowedAuthCallbackOrigin(
  requestUrl: URL,
  source: NodeJS.ProcessEnv = process.env,
): string | null {
  const allowedOrigins = new Set(
    AUTH_ORIGIN_ENV_KEYS.map((key) => source[key])
      .filter((value): value is string => Boolean(value))
      .map(normalizeOrigin)
      .filter((value): value is string => Boolean(value)),
  );

  return allowedOrigins.has(requestUrl.origin) ? requestUrl.origin : null;
}
