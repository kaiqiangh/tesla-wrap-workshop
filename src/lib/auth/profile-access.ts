import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../database.types";
import { createServerSupabaseClient } from "../supabase/server";

export type ProfileAccess =
  | { status: "guest" }
  | { status: "unavailable"; userId: string }
  | { status: "incomplete"; userId: string }
  | { status: "active"; username: string; userId: string };

export async function readProfileAccess(
  suppliedClient?: SupabaseClient<Database>,
): Promise<ProfileAccess> {
  const supabase = suppliedClient ?? (await createServerSupabaseClient());
  const { data: identity, error: identityError } =
    await supabase.auth.getClaims();
  if (identityError || !identity?.claims.sub) return { status: "guest" };

  const { data, error } = await supabase.rpc("current_profile_access");
  if (error) throw new Error("Profile access is temporarily unavailable");
  const access = data[0];
  if (!access || !access.may_onboard) {
    return { status: "unavailable", userId: identity.claims.sub };
  }
  if (!access.may_participate || !access.username) {
    return { status: "incomplete", userId: identity.claims.sub };
  }
  return {
    status: "active",
    username: access.username,
    userId: identity.claims.sub,
  };
}
