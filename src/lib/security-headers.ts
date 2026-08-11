const BASE_SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
};

export function baseSecurityHeaders() {
  return { ...BASE_SECURITY_HEADERS };
}

export function securityHeaders(
  nonce: string,
  supabaseUrl: string,
  siteUrl: string,
  environment: "local" | "development" | "production" = "production",
) {
  const supabaseOrigin = new URL(supabaseUrl).origin;
  const socketOrigin = supabaseOrigin.replace(/^http/, "ws");
  const headers = baseSecurityHeaders();
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      environment === "local" ? " 'unsafe-eval'" : ""
    }`,
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseOrigin} ${socketOrigin}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
  ].join("; ");
  return {
    ...headers,
    "content-security-policy": csp,
    ...(environment !== "production"
      ? { "x-robots-tag": "noindex, nofollow, noarchive" }
      : {}),
    ...(new URL(siteUrl).protocol === "https:"
      ? {
          "strict-transport-security": "max-age=31536000; includeSubDomains",
        }
      : {}),
  };
}
