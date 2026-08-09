import { describe, expect, it } from "vitest";

import { authCallbackUrl, safeNextPath } from "./redirect";

describe("authentication redirects", () => {
  it("keeps a relative destination inside the Environment Pair", () => {
    expect(safeNextPath("/upload?step=vehicle")).toBe("/upload?step=vehicle");
    expect(
      authCallbackUrl("http://127.0.0.1:3000", "/upload?step=vehicle"),
    ).toBe(
      "http://127.0.0.1:3000/auth/callback?next=%2Fupload%3Fstep%3Dvehicle",
    );
  });

  it.each([
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "/\\attacker.example/steal",
    "upload",
  ])("falls back safely for %s", (candidate) => {
    expect(safeNextPath(candidate)).toBe("/");
  });
});
