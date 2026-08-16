import { describe, expect, it } from "vitest";

import {
  createGuestToken,
  GUEST_DOWNLOAD_COOKIE_MAX_AGE,
  guestPrincipalHash,
  userPrincipalHash,
} from "./principal";
import { safeDownloadFilename } from "./filename";

describe("download principals", () => {
  it("creates a versioned HMAC without storing the Guest token", () => {
    const token = createGuestToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(guestPrincipalHash(token, "secret")).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(guestPrincipalHash(token, "other")).not.toBe(
      guestPrincipalHash(token, "secret"),
    );
    expect(GUEST_DOWNLOAD_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 30);
  });

  it("uses the canonical Auth User identity for authenticated grants", () => {
    expect(userPrincipalHash("00000000-0000-0000-0000-000000000001")).toBe(
      "v1:user:00000000-0000-0000-0000-000000000001",
    );
  });

  it("keeps the Content-Disposition filename conservative and bounded", () => {
    const filename = safeDownloadFilename(
      "A very long / unsafe Tesla Wrap 名称",
    );
    expect(filename).toMatch(/^[\x20-\x7e]+\.png$/);
    expect(filename.length).toBeLessThanOrEqual(30);
  });
});
