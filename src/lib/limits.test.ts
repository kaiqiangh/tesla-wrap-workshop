import { describe, expect, it } from "vitest";

import { hmacPrincipal, requestNetworkPrincipal } from "./limits";

describe("launch limit principals", () => {
  it("keeps HMAC principals pseudonymous and stable for rolling windows", () => {
    expect(hmacPrincipal("secret", "search", "guest-session")).toMatch(
      /^v2:search:[0-9a-f]{64}$/,
    );
    expect(hmacPrincipal("secret", "search", "guest-session")).toBe(
      hmacPrincipal("secret", "search", "guest-session"),
    );
  });

  it("uses the edge-provided address before the forwarded chain", () => {
    expect(
      requestNetworkPrincipal(
        new Request("http://localhost", {
          headers: {
            "x-real-ip": "192.0.2.10",
            "x-forwarded-for": "198.51.100.4, 203.0.113.9",
          },
        }),
      ),
    ).toBe("192.0.2.10");
    expect(
      requestNetworkPrincipal(
        new Request("http://localhost", {
          headers: { "x-forwarded-for": "198.51.100.4, 203.0.113.9" },
        }),
      ),
    ).toBe("203.0.113.9");
  });
});
