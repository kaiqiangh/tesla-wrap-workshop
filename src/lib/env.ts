type PublicEnvironment = {
  NEXT_PUBLIC_SITE_URL: string;
  WRAPFORGE_ENVIRONMENT: "local" | "development" | "production";
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
};

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export function readPublicEnvironment(
  source: Record<string, string | undefined>,
): PublicEnvironment {
  const required = [
    "NEXT_PUBLIC_SITE_URL",
    "WRAPFORGE_ENVIRONMENT",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ] as const;

  for (const name of required) {
    if (!source[name]?.trim())
      throw new Error(`Missing required environment variable: ${name}`);
  }

  const mode = source.WRAPFORGE_ENVIRONMENT;
  if (mode !== "local" && mode !== "development" && mode !== "production") {
    throw new Error(
      "WRAPFORGE_ENVIRONMENT must be local, development, or production",
    );
  }
  if (
    source.NEXT_PUBLIC_WRAPFORGE_ENVIRONMENT &&
    source.NEXT_PUBLIC_WRAPFORGE_ENVIRONMENT !== mode
  ) {
    throw new Error("Server and browser environment identities must match");
  }

  const siteUrl = new URL(source.NEXT_PUBLIC_SITE_URL!);
  const supabaseUrl = new URL(source.NEXT_PUBLIC_SUPABASE_URL!);
  if (
    mode === "local" &&
    (!loopbackHosts.has(siteUrl.hostname) ||
      !loopbackHosts.has(supabaseUrl.hostname))
  ) {
    throw new Error("Local mode requires local site and Supabase URLs");
  }
  if (mode !== "local" && loopbackHosts.has(supabaseUrl.hostname)) {
    throw new Error("A local Supabase URL is only valid in local mode");
  }
  if (
    mode === "production" &&
    (siteUrl.protocol !== "https:" || supabaseUrl.protocol !== "https:")
  ) {
    throw new Error("Production URLs must use HTTPS");
  }

  return {
    NEXT_PUBLIC_SITE_URL: siteUrl.origin,
    WRAPFORGE_ENVIRONMENT: mode,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl.origin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  };
}
