export type OnboardingInput = {
  username: string;
  displayName: string;
};

type OnboardingResult =
  | { ok: true; value: OnboardingInput }
  | {
      ok: false;
      code: "invalid_username" | "invalid_display_name";
      message: string;
    };

export function validateOnboardingInput(
  input: OnboardingInput,
): OnboardingResult {
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim();

  if (username.length < 3 || username.length > 30) {
    return {
      ok: false,
      code: "invalid_username",
      message: "Username must be 3–30 characters.",
    };
  }
  if (!/^[a-z0-9]/.test(username)) {
    return {
      ok: false,
      code: "invalid_username",
      message: "Username must start with a letter or number.",
    };
  }
  if (!/^[a-z0-9_-]+$/.test(username)) {
    return {
      ok: false,
      code: "invalid_username",
      message: "Use only letters, numbers, underscores, or dashes.",
    };
  }
  if (displayName.length < 1 || [...displayName].length > 60) {
    return {
      ok: false,
      code: "invalid_display_name",
      message: "Display name must be 1–60 characters.",
    };
  }

  return { ok: true, value: { username, displayName } };
}
