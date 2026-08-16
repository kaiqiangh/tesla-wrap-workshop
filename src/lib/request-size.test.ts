import { describe, expect, it } from "vitest";

import {
  MULTIPART_OVERHEAD_BYTES,
  requestContentLengthExceedsLimit,
} from "./request-size";

describe("requestContentLengthExceedsLimit", () => {
  const limit = 2 * 1024 * 1024;

  it.each([
    [null, false],
    [String(limit + MULTIPART_OVERHEAD_BYTES), false],
    [String(limit + MULTIPART_OVERHEAD_BYTES + 1), true],
    ["999999999999999999999", true],
    ["0x210001", false],
    ["+2162689", false],
    ["not-a-length", false],
  ])("handles declared request size %s", (contentLength, expected) => {
    expect(requestContentLengthExceedsLimit(contentLength, limit)).toBe(
      expected,
    );
  });

  it("keeps the request limit exact at the safe integer boundary", () => {
    const maxFileBytes = Number.MAX_SAFE_INTEGER;
    const threshold = BigInt(maxFileBytes) + BigInt(MULTIPART_OVERHEAD_BYTES);

    expect(
      requestContentLengthExceedsLimit(String(threshold), maxFileBytes),
    ).toBe(false);
    expect(
      requestContentLengthExceedsLimit(String(threshold + 1n), maxFileBytes),
    ).toBe(true);
  });
});
