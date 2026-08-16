import { describe, expect, it } from "vitest";

import { normalizeTag, validateWrapMetadata } from "./metadata";

const valid = {
  title: "  Night Drive  ",
  description: "A graphite road scene.",
  licenseType: "PERSONAL_USE_ALLOWED",
  tags: ["Night Drive", "night-drive", "Graphite"],
  templateAsserted: true,
  distributionAsserted: true,
};

describe("Wrap metadata", () => {
  it("trims bounded metadata and canonicalizes duplicate Tags", () => {
    expect(validateWrapMetadata(valid)).toEqual({
      ok: true,
      value: {
        title: "Night Drive",
        description: "A graphite road scene.",
        licenseType: "PERSONAL_USE_ALLOWED",
        tags: ["night-drive", "graphite"],
        templateAsserted: true,
        distributionAsserted: true,
      },
    });
  });

  it.each([
    ["title", { ...valid, title: " " }, "WF-WRAP-TITLE"],
    ["description", { ...valid, description: " " }, "WF-WRAP-DESCRIPTION"],
    [
      "description",
      { ...valid, description: "x".repeat(2_001) },
      "WF-WRAP-DESCRIPTION",
    ],
    ["license", { ...valid, licenseType: "NOPE" }, "WF-WRAP-LICENSE"],
    [
      "tags",
      { ...valid, tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) },
      "WF-WRAP-TAGS",
    ],
    [
      "assertions",
      { ...valid, distributionAsserted: false },
      "WF-WRAP-ASSERTIONS",
    ],
  ])("rejects invalid %s", (_, input, code) => {
    expect(validateWrapMetadata(input).ok).toBe(false);
    expect(validateWrapMetadata(input)).toMatchObject({
      problem: { code },
    });
  });

  it("normalizes punctuation into one canonical tag slug", () => {
    expect(normalizeTag("  Neon / Night  ")).toBe("neon-night");
  });
});
