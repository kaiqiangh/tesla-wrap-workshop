import {
  isValidProfileDisplayName,
  normalizeProfileIdentity,
  validateProfileUsername,
} from "./identity";

export type ProfileSettingsInput = {
  username: string;
  displayName: string;
  bio: string;
};

export type ProfileSettingsResult =
  | { ok: true; value: ProfileSettingsInput }
  | {
      ok: false;
      code: "invalid_username" | "invalid_display_name" | "invalid_bio";
      message: string;
    };

export function validateProfileSettings(
  input: ProfileSettingsInput,
): ProfileSettingsResult {
  const { username, displayName } = normalizeProfileIdentity(input);
  const bio = input.bio.trim();

  if (validateProfileUsername(username)) {
    return {
      ok: false,
      code: "invalid_username",
      message: "Username must be 3–30 lowercase letters, numbers, _ or -.",
    };
  }
  if (!isValidProfileDisplayName(displayName)) {
    return {
      ok: false,
      code: "invalid_display_name",
      message: "Display name must be 1–60 characters.",
    };
  }
  if ([...bio].length > 500) {
    return {
      ok: false,
      code: "invalid_bio",
      message: "Bio must be at most 500 characters.",
    };
  }
  return { ok: true, value: { username, displayName, bio } };
}
