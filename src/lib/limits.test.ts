import { describe, expect, it } from "vitest";

import {
  hmacPrincipal,
  headerNetworkPrincipal,
  requestNetworkPrincipal,
  searchPrincipal,
} from "./limits";

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
  });

  it("takes the original client from the start of the forwarded chain", () => {
    expect(
      headerNetworkPrincipal(
        new Headers({ "x-forwarded-for": "198.51.100.4, 203.0.113.9" }),
      ),
    ).toBe("198.51.100.4");
    expect(headerNetworkPrincipal(new Headers())).toBe("unknown");
  });

  it("keys cookieless search traffic stably per network address", () => {
    expect(searchPrincipal("secret", null, "192.0.2.10")).toBe(
      searchPrincipal("secret", null, "192.0.2.10"),
    );
    expect(searchPrincipal("secret", null, "192.0.2.10")).toMatch(
      /^v2:network:[0-9a-f]{64}$/,
    );
    expect(searchPrincipal("secret", null, "192.0.2.10")).not.toBe(
      searchPrincipal("secret", null, "192.0.2.11"),
    );
    expect(searchPrincipal("secret", "sess-1", "192.0.2.10")).not.toBe(
      searchPrincipal("secret", null, "192.0.2.10"),
    );
  });

  it("keeps session-cookie principals identical to the search kind", () => {
    expect(searchPrincipal("secret", "guest-session", "192.0.2.10")).toBe(
      hmacPrincipal("secret", "search", "guest-session"),
    );
    // The retired shared "missing" bucket must never come back.
    expect(searchPrincipal("secret", null, "unknown")).not.toBe(
      hmacPrincipal("secret", "search", "missing"),
    );
  });
});
