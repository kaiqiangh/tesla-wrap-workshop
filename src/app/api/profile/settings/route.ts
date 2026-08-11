import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { validateProfileSettings } from "@/lib/profile/settings";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function PUT(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return problem(400, "invalid_request", "Enter your Profile details.");
  }
  if (!isInput(input))
    return problem(400, "invalid_request", "Enter your Profile details.");

  const validated = validateProfileSettings(input);
  if (!validated.ok) return problem(400, validated.code, validated.message);

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
  if (access.status !== "active")
    return problem(
      403,
      "profile_unavailable",
      "Your Profile cannot be edited right now.",
    );

  const { data, error } = await supabase.rpc("update_profile", {
    p_username: validated.value.username,
    p_display_name: validated.value.displayName,
    p_bio: validated.value.bio,
  });
  if (error?.message === "username_cooldown")
    return problem(
      409,
      "username_cooldown",
      "Username changes are limited to once every 30 days.",
    );
  if (error?.message === "username_unavailable" || error?.code === "23505")
    return problem(
      409,
      "username_unavailable",
      "That Username is unavailable.",
    );
  if (
    error?.message === "username_invalid" ||
    error?.message === "display_name_invalid" ||
    error?.message === "bio_invalid"
  )
    return problem(
      400,
      error.message,
      "Check your Profile details and try again.",
    );
  const profile = data?.[0];
  if (error || !profile?.username)
    return problem(
      503,
      "profile_not_saved",
      "Your Profile could not be saved.",
    );

  return NextResponse.json(profile, {
    headers: { "cache-control": "no-store" },
  });
}

function isInput(value: unknown): value is {
  username: string;
  displayName: string;
  bio: string;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) =>
      ["username", "displayName", "bio"].includes(key),
    ) &&
    typeof record.username === "string" &&
    typeof record.displayName === "string" &&
    typeof record.bio === "string"
  );
}

function problem(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}
