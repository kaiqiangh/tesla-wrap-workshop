import { createHmac, randomBytes } from "node:crypto";

export const GUEST_DOWNLOAD_COOKIE = "wf_guest_download";
export const GUEST_DOWNLOAD_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function createGuestToken() {
  return randomBytes(32).toString("base64url");
}

export function guestPrincipalHash(token: string, secret: string) {
  return `v1:${createHmac("sha256", secret).update(token).digest("hex")}`;
}

export function userPrincipalHash(userId: string) {
  return `v1:user:${userId}`;
}
