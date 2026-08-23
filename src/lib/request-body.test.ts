import { describe, expect, it } from "vitest";

import { readJsonBody } from "./request-body";

describe("readJsonBody", () => {
  it("parses a JSON object", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(await readJsonBody(request)).toEqual({
      ok: true,
      body: { enabled: true },
    });
  });

  it("rejects a non-JSON Content-Type before parsing", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    expect((await readJsonBody(request)).ok).toBe(false);
  });

  it("rejects bodies whose declared length exceeds the cap", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "70000",
      },
      body: JSON.stringify({ large: "x".repeat(10) }),
    });
    expect(
      (await readJsonBody(request, { maxBytes: 64 * 1024 })).ok,
    ).toBe(false);
  });

  it("rejects malformed JSON payloads", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect((await readJsonBody(request)).ok).toBe(false);
  });

  it("rejects non-object JSON values", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '"just a string"',
    });
    expect((await readJsonBody(request)).ok).toBe(false);
  });
});