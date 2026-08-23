import { describe, expect, it } from "vitest";

import {
  isValidProfileDisplayName,
  normalizeProfileIdentity,
  validateProfileUsername,
} from "./identity";

describe("normalizeProfileIdentity", () => {
  it("trims and lowercases the username, trims the display name", () => {
    expect(
      normalizeProfileIdentity({
        username: " RoadOne ",
        displayName: " Road One ",
      }),
    ).toEqual({ username: "roadone", displayName: "Road One" });
  });
});

describe("validateProfileUsername", () => {
  it("rejects usernames outside three to thirty characters", () => {
    expect(validateProfileUsername("ab")).toBe("length");
    expect(validateProfileUsername("a".repeat(31))).toBe("length");
  });

  it("requires a lowercase alphanumeric start", () => {
    expect(validateProfileUsername("-abc")).toBe("start");
    expect(validateProfileUsername("1abc")).toBeNull();
  });

  it("allows only lowercase alphanumerics, dashes, and underscores", () => {
    expect(validateProfileUsername("road-one_2")).toBeNull();
    expect(validateProfileUsername("road one")).toBe("characters");
  });

  it("accepts a valid username", () => {
    expect(validateProfileUsername("road-one")).toBeNull();
  });
});

describe("isValidProfileDisplayName", () => {
  it("accepts one to sixty characters counted by code point", () => {
    expect(isValidProfileDisplayName("R")).toBe(true);
    expect(isValidProfileDisplayName("車".repeat(60))).toBe(true);
  });

  it("rejects empty and overlong display names", () => {
    expect(isValidProfileDisplayName("")).toBe(false);
    expect(isValidProfileDisplayName("車".repeat(61))).toBe(false);
  });
});
