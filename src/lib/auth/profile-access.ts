import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../database.types";
import { createServerSupabaseClient } from "../supabase/server";

export type ProfileAccess =
  | { status: "guest" }
  | { status: "unavailable" }
  | { status: "incomplete" }
  | { status: "active"; username: string };

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
    return { status: "unavailable" };
  }
  if (!access.may_participate || !access.username) {
    return { status: "incomplete" };
  }
  return { status: "active", username: access.username };
}
