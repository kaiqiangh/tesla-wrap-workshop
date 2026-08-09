import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../database.types";
import { createServerSupabaseClient } from "../supabase/server";

export type ProfileAccess =
  | { status: "guest" }
  | { status: "unavailable" }
  | { status: "incomplete"; userId: string }
  | { status: "active"; userId: string; username: string };

export async function readProfileAccess(
  suppliedClient?: SupabaseClient<Database>,
): Promise<ProfileAccess> {
  const supabase = suppliedClient ?? (await createServerSupabaseClient());
  const { data: identity, error: identityError } =
    await supabase.auth.getClaims();
  const userId = identity?.claims.sub;
  if (identityError || !userId) return { status: "guest" };

  const { data, error } = await supabase.rpc("current_profile_access");
  if (error) throw new Error("Profile access is temporarily unavailable");
  const access = data[0];
  if (!access || access.user_id !== userId || !access.may_onboard) {
    return { status: "unavailable" };
  }
  if (!access.may_participate || !access.username) {
    return { status: "incomplete", userId };
  }
  return { status: "active", userId, username: access.username };
}
