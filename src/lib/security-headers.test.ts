import { describe, expect, it } from "vitest";

import { baseSecurityHeaders, securityHeaders } from "./security-headers";

describe("security headers", () => {
  it("keeps static response protections restrictive", () => {
    const headers = baseSecurityHeaders();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["permissions-policy"]).not.toContain("*");
  });

  it("builds a nonce CSP without wildcard or unsafe script directives", () => {
    const headers = securityHeaders(
      "nonce123",
      "http://127.0.0.1:54321",
      "http://127.0.0.1:3000",
    );
    const csp = headers["content-security-policy"];
    expect(csp).toContain("'nonce-nonce123'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("*");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("http://127.0.0.1:54321");
    expect(csp).toContain("ws://127.0.0.1:54321");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(headers["strict-transport-security"]).toBeUndefined();
  });

  it("allows only the local development evaluator escape hatch", () => {
    expect(
      securityHeaders(
        "nonce123",
        "http://127.0.0.1:54321",
        "http://127.0.0.1:3000",
        "local",
      )["content-security-policy"],
    ).toContain("'unsafe-eval'");
  });

  it("adds HSTS only for HTTPS Environment Pairs", () => {
    expect(
      securityHeaders(
        "nonce123",
        "https://supabase.example",
        "https://wrapforge.example",
      )["strict-transport-security"],
    ).toBe("max-age=31536000; includeSubDomains");
  });

  it("marks non-production responses unavailable to crawlers", () => {
    expect(
      securityHeaders(
        "nonce123",
        "https://supabase.example",
        "https://preview.wrapforge.example",
        "development",
      )["x-robots-tag"],
    ).toBe("noindex, nofollow, noarchive");
    expect(
      securityHeaders(
        "nonce123",
        "https://supabase.example",
        "https://wrapforge.example",
        "production",
      )["x-robots-tag"],
    ).toBeUndefined();
  });
});
