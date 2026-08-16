export type ProfileIdentityInput = {
  username: string;
  displayName: string;
};

export type ProfileUsernameError = "length" | "start" | "characters";

export function normalizeProfileIdentity(input: ProfileIdentityInput) {
  return {
    username: input.username.trim().toLowerCase(),
    displayName: input.displayName.trim(),
  };
}

export function validateProfileUsername(
  username: string,
): ProfileUsernameError | null {
  if (username.length < 3 || username.length > 30) return "length";
  if (!/^[a-z0-9]/.test(username)) return "start";
  if (!/^[a-z0-9_-]+$/.test(username)) return "characters";
  return null;
}

export function isValidProfileDisplayName(displayName: string) {
  const length = [...displayName].length;
  return length >= 1 && length <= 60;
}
