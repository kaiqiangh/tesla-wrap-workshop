import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST() {
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
  if (access.status !== "active" && access.status !== "unavailable")
    return problem(
      403,
      "profile_unavailable",
      "Your Profile cannot be deactivated right now.",
    );
  const { data, error } = await supabase.rpc("deactivate_profile");
  if (error?.message === "profile_unavailable")
    return problem(
      403,
      "profile_unavailable",
      "Your Profile cannot be deactivated right now.",
    );
  if (error || !data?.[0])
    return problem(
      503,
      "profile_not_saved",
      "Your Profile could not be deactivated.",
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
