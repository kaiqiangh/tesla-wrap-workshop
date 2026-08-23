import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { readJsonBody } from "@/lib/request-body";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { validateOnboardingInput } from "@/lib/profile/onboarding";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export function POST(request: Request) {
  return observeRoute(request, "PROFILE_ONBOARD", "PROFILE", (operation) =>
    post(request, operation),
  );
}

async function post(request: Request, operation: OperationContext) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok)
    return problem(400, "invalid_request", "Enter a Username and display name.");
  const input = parsed.body;
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
  if (access.status !== "guest") operation.actorId = access.userId;
  if (access.status === "guest") {
    return problem(401, "authentication_required", "Sign in to continue.");
  }
  if (access.status === "unavailable") {
    return problem(403, "profile_unavailable", "This Profile is unavailable.");
  }
  if (access.status === "active") {
    return problem(
      409,
      "profile_complete",
      "Your Profile is already complete.",
    );
  }
  const { data, error } = await supabase.rpc("complete_profile", {
    p_username: validated.value.username,
    p_display_name: validated.value.displayName,
  });
  const profile = data?.[0];

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
  if (error || !profile?.username) {
    return problem(
      409,
      "profile_not_saved",
      "Your Profile could not be saved.",
    );
  }

  return NextResponse.json(
    { username: profile.username },
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
