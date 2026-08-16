import { redirect } from "next/navigation";

import {
  readProfileAccess,
  type ProfileAccess,
} from "@/lib/auth/profile-access";

export async function readProfileAccessOrRedirect(
  next: string,
): Promise<ProfileAccess> {
  try {
    return await readProfileAccess();
  } catch {
    redirect(
      `/sign-in?error=profile_unavailable&next=${encodeURIComponent(next)}`,
    );
  }
}
