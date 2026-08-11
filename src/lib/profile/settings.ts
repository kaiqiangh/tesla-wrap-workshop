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
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const bio = input.bio.trim();

  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(username)) {
    return {
      ok: false,
      code: "invalid_username",
      message: "Username must be 3–30 lowercase letters, numbers, _ or -.",
    };
  }
  if ([...displayName].length < 1 || [...displayName].length > 60) {
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
