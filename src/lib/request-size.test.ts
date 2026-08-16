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
});
