import type { SupabaseClient } from "@supabase/supabase-js";

import type { OperationContext } from "../observability";
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

export type GateCodes = {
  auth: string;
  participation: string;
  db: string;
};

export type ProfileGate =
  | { ok: true; username: string; userId: string }
  | { ok: false; response: Response };

export type DomainProblem = (
  status: number,
  code: string,
  problemText: string,
  rule: string,
  nextAction: string,
) => Response;

// Single source of truth for profile-gated endpoints (WU-13/PR-07/PR-06/
// LIB-03): one owner for status mapping, throw handling, and actor
// assignment. Routes keep their domain problem helper and codes, so no
// client-visible contract changes; bodies gain consistent generic texts.
export async function requireActiveProfile(
  supabase: SupabaseClient<Database>,
  operation: OperationContext,
  problem: DomainProblem,
  codes: GateCodes,
): Promise<ProfileGate> {
  let access: ProfileAccess;
  try {
    access = await readProfileAccess(supabase);
  } catch {
    return {
      ok: false,
      response: problem(
        503,
        codes.db,
        "The Profile boundary is temporarily unavailable.",
        "Profile access must be readable to authorize this action.",
        "Retry after the service recovers.",
      ),
    };
  }
  if (access.status === "guest") {
    return {
      ok: false,
      response: problem(
        401,
        codes.auth,
        "Sign in to continue.",
        "This action requires a completed Active Profile.",
        "Sign in and try again.",
      ),
    };
  }
  operation.actorId = access.userId;
  if (access.status !== "active") {
    return {
      ok: false,
      response: problem(
        403,
        codes.participation,
        "Your Profile cannot perform this action right now.",
        "A completed Active Profile is required.",
        "Complete or restore your Profile before trying again.",
      ),
    };
  }
  return { ok: true, username: access.username, userId: access.userId };
}
