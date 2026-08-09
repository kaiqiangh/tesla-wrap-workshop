export const LICENSE_TYPES = [
  "PERSONAL_USE_ALLOWED",
  "CREATIVE_COMMONS",
  "OTHER",
] as const;

export type LicenseType = (typeof LICENSE_TYPES)[number];

export type WrapMetadataInput = {
  title: string;
  description: string;
  licenseType: string;
  tags: string[];
  templateAsserted: boolean;
  distributionAsserted: boolean;
};

export type WrapMetadata = {
  title: string;
  description: string;
  licenseType: LicenseType;
  tags: string[];
  templateAsserted: true;
  distributionAsserted: true;
};

export type WrapMetadataProblem = {
  code:
    | "WF-WRAP-TITLE"
    | "WF-WRAP-DESCRIPTION"
    | "WF-WRAP-LICENSE"
    | "WF-WRAP-TAGS"
    | "WF-WRAP-ASSERTIONS";
  measured: string;
  nextAction: string;
};

export function validateWrapMetadata(
  input: WrapMetadataInput,
):
  | { ok: true; value: WrapMetadata }
  | { ok: false; problem: WrapMetadataProblem } {
  const title = input.title.trim();
  if (title.length < 1 || [...title].length > 80) {
    return {
      ok: false,
      problem: {
        code: "WF-WRAP-TITLE",
        measured: `${[...title].length} characters`,
        nextAction: "Use a title between 1 and 80 characters.",
      },
    };
  }
  const description = input.description.trim();
  if (description.length < 1 || [...description].length > 2_000) {
    return {
      ok: false,
      problem: {
        code: "WF-WRAP-DESCRIPTION",
        measured: `${[...description].length} characters`,
        nextAction: "Use a description between 1 and 2,000 characters.",
      },
    };
  }
  if (!LICENSE_TYPES.includes(input.licenseType as LicenseType)) {
    return {
      ok: false,
      problem: {
        code: "WF-WRAP-LICENSE",
        measured: "No supported license was selected",
        nextAction: "Choose Personal Use Allowed, Creative Commons, or Other.",
      },
    };
  }
  const tags = [...new Set(input.tags.map(normalizeTag).filter(Boolean))];
  if (tags.length > 10 || tags.some((tag) => tag.length > 30)) {
    return {
      ok: false,
      problem: {
        code: "WF-WRAP-TAGS",
        measured: `${tags.length} canonical tags`,
        nextAction: "Use at most ten tags, each no longer than 30 characters.",
      },
    };
  }
  if (!input.templateAsserted || !input.distributionAsserted) {
    return {
      ok: false,
      problem: {
        code: "WF-WRAP-ASSERTIONS",
        measured: "One or more required confirmations is missing",
        nextAction:
          "Confirm the official template and your right to distribute the artwork.",
      },
    };
  }
  return {
    ok: true,
    value: {
      title,
      description,
      licenseType: input.licenseType as LicenseType,
      tags,
      templateAsserted: true,
      distributionAsserted: true,
    },
  };
}

export function normalizeTag(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
