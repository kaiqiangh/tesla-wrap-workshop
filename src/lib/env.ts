type PublicEnvironment = {
  NEXT_PUBLIC_SITE_URL: string;
  WRAPFORGE_ENVIRONMENT: "local" | "development" | "production";
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
};

export type ServerEnvironment = PublicEnvironment & {
  SUPABASE_SECRET_KEY: string;
  DOWNLOAD_PRINCIPAL_HMAC_SECRET: string;
  CRON_SECRET?: string;
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

export function readServerEnvironment(
  source: Record<string, string | undefined>,
): ServerEnvironment {
  const publicEnvironment = readPublicEnvironment(source);
  if (!source.SUPABASE_SECRET_KEY?.trim()) {
    throw new Error(
      "Missing required environment variable: SUPABASE_SECRET_KEY",
    );
  }
  if (!source.DOWNLOAD_PRINCIPAL_HMAC_SECRET?.trim()) {
    throw new Error(
      "Missing required environment variable: DOWNLOAD_PRINCIPAL_HMAC_SECRET",
    );
  }
  if (source.DOWNLOAD_PRINCIPAL_HMAC_SECRET.length < 32) {
    throw new Error(
      "DOWNLOAD_PRINCIPAL_HMAC_SECRET must be at least 32 characters",
    );
  }
  if (
    publicEnvironment.WRAPFORGE_ENVIRONMENT !== "local" &&
    (!source.CRON_SECRET?.trim() || source.CRON_SECRET.length < 32)
  ) {
    throw new Error(
      "CRON_SECRET must be at least 32 characters outside local mode",
    );
  }
  if (
    publicEnvironment.WRAPFORGE_ENVIRONMENT !== "local" &&
    source.SUPABASE_JWT_SECRET &&
    source.DOWNLOAD_PRINCIPAL_HMAC_SECRET === source.SUPABASE_JWT_SECRET
  ) {
    throw new Error(
      "DOWNLOAD_PRINCIPAL_HMAC_SECRET must be separate from SUPABASE_JWT_SECRET",
    );
  }
  return {
    ...publicEnvironment,
    SUPABASE_SECRET_KEY: source.SUPABASE_SECRET_KEY,
    DOWNLOAD_PRINCIPAL_HMAC_SECRET: source.DOWNLOAD_PRINCIPAL_HMAC_SECRET,
    CRON_SECRET: source.CRON_SECRET,
  };
}
