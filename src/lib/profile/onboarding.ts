import {
  isValidProfileDisplayName,
  normalizeProfileIdentity,
  validateProfileUsername,
} from "./identity";

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
  const { username, displayName } = normalizeProfileIdentity(input);
  const usernameError = validateProfileUsername(username);

  if (usernameError === "length") {
    return {
      ok: false,
      code: "invalid_username",
      message: "Username must be 3–30 characters.",
    };
  }
  if (usernameError === "start") {
    return {
      ok: false,
      code: "invalid_username",
      message: "Username must start with a letter or number.",
    };
  }
  if (usernameError === "characters") {
    return {
      ok: false,
      code: "invalid_username",
      message: "Use only letters, numbers, underscores, or dashes.",
    };
  }
  if (!isValidProfileDisplayName(displayName)) {
    return {
      ok: false,
      code: "invalid_display_name",
      message: "Display name must be 1–60 characters.",
    };
  }

  return { ok: true, value: { username, displayName } };
}
