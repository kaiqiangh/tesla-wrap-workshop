import { describe, expect, it } from "vitest";

import { isSameOriginRequest } from "./request-origin";

function requestWith(
  headers: Record<string, string>,
  url = "https://wrapforge.test/api/x",
) {
  return new Request(url, { headers });
}

describe("isSameOriginRequest", () => {
  it("rejects explicit cross-site fetch metadata", () => {
    expect(
      isSameOriginRequest(
        requestWith({ "sec-fetch-site": "cross-site", origin: "https://evil.test" }),
      ),
    ).toBe(false);
  });

  it("allows non-browser clients that omit Origin", () => {
    expect(isSameOriginRequest(requestWith({}))).toBe(true);
  });

  it("rejects malformed Origin headers", () => {
    expect(isSameOriginRequest(requestWith({ origin: "not-a-url" }))).toBe(false);
  });

  it("accepts an Origin matching the request Host", () => {
    expect(
      isSameOriginRequest(requestWith({ host: "wrapforge.test", origin: "https://wrapforge.test" })),
    ).toBe(true);
  });

  it("accepts an Origin matching the configured site URL through proxy aliases", () => {
    expect(
      isSameOriginRequest(
        requestWith({
          host: "internal.alias",
          origin: "https://www.wrapforge.test",
        }),
        { siteUrl: "https://www.wrapforge.test" },
      ),
    ).toBe(true);
  });

  it("falls back to the request URL origin when Host is absent", () => {
    expect(
      isSameOriginRequest(requestWith({ origin: "https://wrapforge.test" })),
    ).toBe(true);
  });

  it("rejects a foreign Origin that matches nothing", () => {
    expect(
      isSameOriginRequest(
        requestWith({ host: "wrapforge.test", origin: "https://evil.test" }),
      ),
    ).toBe(false);
  });
});