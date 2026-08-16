import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  return observeRoute(request, "PROFILE_RECOVER", "PROFILE", (operation) =>
    post(operation),
  );
}

async function post(operation: OperationContext) {
  const supabase = await createServerSupabaseClient();
  let access;
  try {
    access = await readProfileAccess(supabase);
  } catch {
    return problem(
      503,
      "profile_unavailable",
      "Profile is temporarily unavailable.",
    );
  }
  if (access.status === "guest")
    return problem(401, "authentication_required", "Sign in to continue.");
  operation.actorId = access.userId;
  if (access.status !== "unavailable")
    return problem(
      409,
      "profile_recovery_unavailable",
      "This Profile is not in a recoverable state.",
    );

  const { data, error } = await supabase.rpc("recover_profile");
  if (error?.message === "profile_recovery_expired")
    return problem(
      409,
      "profile_recovery_expired",
      "The 30-day recovery window has expired.",
    );
  if (error?.message === "profile_recovery_unavailable")
    return problem(
      409,
      "profile_recovery_unavailable",
      "This Profile is not in a recoverable state.",
    );
  if (error || !data?.[0]?.recovered)
    return problem(
      503,
      "profile_recovery_failed",
      "Profile recovery is temporarily unavailable.",
    );
  return NextResponse.json(data[0], {
    headers: { "cache-control": "no-store" },
  });
}

function problem(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}
