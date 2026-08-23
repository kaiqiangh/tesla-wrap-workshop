import { NextResponse } from "next/server";

import { requireActiveProfile } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { readJsonBody } from "@/lib/request-body";
import { validateProfileSettings } from "@/lib/profile/settings";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function PUT(request: Request) {
  return observeRoute(request, "PROFILE_SETTINGS", "PROFILE", (operation) =>
    put(request, operation),
  );
}

async function put(request: Request, operation: OperationContext) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok)
    return problem(400, "invalid_request", "Enter your Profile details.");
  const input = parsed.body;
  if (!isInput(input))
    return problem(400, "invalid_request", "Enter your Profile details.");

  const validated = validateProfileSettings(input);
  if (!validated.ok) return problem(400, validated.code, validated.message);

  const supabase = await createServerSupabaseClient();
  const gate = await requireActiveProfile(
    supabase,
    operation,
    (status, code, message) => problem(status, code, message),
    {
      auth: "authentication_required",
      participation: "profile_unavailable",
      db: "profile_unavailable",
    },
  );
  if (!gate.ok) return gate.response;

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
