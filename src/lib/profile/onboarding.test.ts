import { describe, expect, it } from "vitest";

import { validateOnboardingInput } from "./onboarding";

describe("Profile onboarding input", () => {
  it("normalizes a valid Username and display name", () => {
    expect(
      validateOnboardingInput({
        username: " Road_Builder ",
        displayName: "  Road Builder  ",
      }),
    ).toEqual({
      ok: true,
      value: { username: "road_builder", displayName: "Road Builder" },
    });
  });

  it.each([
    ["ab", "Username must be 3–30 characters."],
    ["-builder", "Username must start with a letter or number."],
    ["road.builder", "Use only letters, numbers, underscores, or dashes."],
  ])("rejects Username %s", (username, message) => {
    expect(
      validateOnboardingInput({ username, displayName: "Road Builder" }),
    ).toEqual({ ok: false, code: "invalid_username", message });
  });

  it("rejects an empty display name after trimming", () => {
    expect(
      validateOnboardingInput({ username: "builder", displayName: "   " }),
    ).toEqual({
      ok: false,
      code: "invalid_display_name",
      message: "Display name must be 1–60 characters.",
    });
  });
});
