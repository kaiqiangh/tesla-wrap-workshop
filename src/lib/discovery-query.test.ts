import { describe, expect, it } from "vitest";

import { discoveryQueryString, parseDiscoveryQuery } from "./discovery-query";

describe("discovery query", () => {
  it("normalizes supported URL state and preserves the cursor", () => {
    const query = parseDiscoveryQuery(
      new URLSearchParams(
        "q=  Café  &model=MODEL-Y&sort=most_downloaded&cursor=0123456789abcdef0123456789abcdef0123",
      ),
    );
    expect(query).toEqual({
      q: "Café",
      model: "model-y",
      sort: "MOST_DOWNLOADED",
      cursor: "0123456789abcdef0123456789abcdef0123",
    });
    expect(discoveryQueryString(query!)).toBe(
      "q=Caf%C3%A9&model=model-y&sort=MOST_DOWNLOADED&cursor=0123456789abcdef0123456789abcdef0123",
    );
  });

  it("rejects invalid sort, oversized query, and oversized cursor", () => {
    expect(parseDiscoveryQuery({ sort: "POPULAR" })).toBeNull();
    expect(parseDiscoveryQuery({ q: "x".repeat(101) })).toBeNull();
    expect(parseDiscoveryQuery({ cursor: "x".repeat(2049) })).toBeNull();
    expect(parseDiscoveryQuery({ cursor: "not-a-cursor" })).toBeNull();
    expect(parseDiscoveryQuery({ cursor: " " })).toBeNull();
  });
});
