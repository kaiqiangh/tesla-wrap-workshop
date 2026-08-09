import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { validateOnboardingInput } from "@/lib/profile/onboarding";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return problem(
      400,
      "invalid_request",
      "Enter a Username and display name.",
    );
  }
  if (!isInput(input)) {
    return problem(
      400,
      "invalid_request",
      "Enter a Username and display name.",
    );
  }

  const validated = validateOnboardingInput(input);
  if (!validated.ok) {
    return problem(400, validated.code, validated.message);
  }

  const supabase = await createServerSupabaseClient();
  const access = await readProfileAccess(supabase);
  if (access.status === "guest") {
    return problem(401, "authentication_required", "Sign in to continue.");
  }
  if (access.status === "unavailable") {
    return problem(403, "account_unavailable", "This account is unavailable.");
  }
  if (access.status === "active") {
    return problem(
      409,
      "profile_complete",
      "Your Profile is already complete.",
    );
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({
      username: validated.value.username,
      display_name: validated.value.displayName,
    })
    .eq("user_id", access.userId)
    .select("username")
    .maybeSingle();

  if (error?.code === "23505") {
    return problem(409, "username_taken", "That Username is already taken.");
  }
  if (error?.code === "P0001") {
    return problem(
      409,
      "username_unavailable",
      "That Username is unavailable.",
    );
  }
  if (error?.code === "23514") {
    return problem(
      400,
      "invalid_profile",
      "Check your Profile details and try again.",
    );
  }
  if (error || !data?.username) {
    return problem(
      409,
      "profile_not_saved",
      "Your Profile could not be saved.",
    );
  }

  return NextResponse.json(
    { username: data.username },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}

function isInput(value: unknown): value is {
  username: string;
  displayName: string;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) =>
      ["username", "displayName"].includes(key),
    ) &&
    typeof record.username === "string" &&
    typeof record.displayName === "string"
  );
}

function problem(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}
