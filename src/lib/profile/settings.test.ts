import { describe, expect, it } from "vitest";

import { validateProfileSettings } from "./settings";

describe("validateProfileSettings", () => {
  it("normalizes the editable identity", () => {
    expect(
      validateProfileSettings({
        username: "  Road_One ",
        displayName: "  Road One ",
        bio: "  Dublin creator ",
      }),
    ).toEqual({
      ok: true,
      value: {
        username: "road_one",
        displayName: "Road One",
        bio: "Dublin creator",
      },
    });
  });

  it.each([
    ["username", { username: "-bad", displayName: "Name", bio: "" }],
    ["display name", { username: "valid-name", displayName: "", bio: "" }],
    [
      "bio",
      { username: "valid-name", displayName: "Name", bio: "x".repeat(501) },
    ],
  ])("rejects an invalid %s", (_label, input) => {
    expect(validateProfileSettings(input).ok).toBe(false);
  });
});
