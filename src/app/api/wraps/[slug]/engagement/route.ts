import { NextResponse } from "next/server";

import { requireActiveProfile } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { wrapProblem } from "@/lib/wraps/problem";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params) {
  return observeRoute(request, "SOCIAL_MUTATION", "WRAP", (operation) =>
    post(request, { params }, operation),
  );
}

async function post(
  request: Request,
  { params }: Params,
  operation: OperationContext,
) {
  const { slug } = await params;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return requestProblem();
  }
  if (!isInput(input)) return requestProblem();

  let supabase;
  try {
    supabase = await createServerSupabaseClient();
    const gate = await requireActiveProfile(supabase, operation, wrapProblem, {
      auth: "WF-SOCIAL-AUTH",
      participation: "WF-SOCIAL-PARTICIPATION",
      db: "WF-SOCIAL-DATABASE",
    });
    if (!gate.ok) return gate.response;

    const { data, error } = await supabase.rpc("toggle_wrap_engagement", {
      p_enabled: input.enabled,
      p_kind: input.kind,
      p_slug: slug,
    });
    if (error) return mapDatabaseError(error.message);
    const result = data?.[0];
    if (!result) return databaseProblem();
    return NextResponse.json(
      {
        kind: result.kind,
        enabled: result.enabled,
        likeCount: result.like_count,
        favoriteCount: result.favorite_count,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return databaseProblem();
  }
}

function isInput(value: unknown): value is {
  kind: "LIKE" | "FAVORITE";
  enabled: boolean;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) => ["kind", "enabled"].includes(key)) &&
    (record.kind === "LIKE" || record.kind === "FAVORITE") &&
    typeof record.enabled === "boolean"
  );
}

function requestProblem() {
  return wrapProblem(
    400,
    "WF-SOCIAL-REQUEST",
    "The social action request is incomplete.",
    "Choose Like or Favorite and send an explicit enabled state.",
    "Retry the action from the Wrap detail page.",
  );
}

function mapDatabaseError(message: string) {
  if (message === "social_actor_unavailable") {
    return wrapProblem(
      403,
      "WF-SOCIAL-PARTICIPATION",
      "Your Profile cannot use social actions right now.",
      "Likes and Favorites require a completed Active Profile.",
      "Complete or restore your Profile before trying again.",
    );
  }
  if (message === "social_self_action") {
    return wrapProblem(
      403,
      "WF-SOCIAL-SELF",
      "You cannot Like or Favorite your own Wrap.",
      "Social influence must come from another eligible User.",
      "Open another Creator's Published Wrap to continue.",
    );
  }
  if (message === "social_wrap_unavailable") {
    return wrapProblem(
      409,
      "WF-SOCIAL-WRAP",
      "This Wrap is no longer available for social actions.",
      "Only an eligible Published Wrap can receive new Likes or Favorites.",
      "Refresh the Wrap and choose another Published Wrap if needed.",
    );
  }
  if (message === "invalid_social_kind" || message === "invalid_social_state") {
    return requestProblem();
  }
  if (message === "social_rate_limited") {
    return wrapProblem(
      429,
      "WF-SOCIAL-RATE",
      "Social actions are temporarily limited.",
      "At most sixty Like or Favorite operations are allowed per User per rolling minute.",
      "Wait before trying another social action.",
      { "retry-after": "60" },
    );
  }
  return databaseProblem();
}

function databaseProblem() {
  return wrapProblem(
    503,
    "WF-SOCIAL-DATABASE",
    "The social action could not be recorded safely.",
    "The relationship, engagement event, and public count must commit together.",
    "Retry the same action after the service recovers.",
  );
}
