import { NextResponse } from "next/server";

import { requireActiveProfile } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { wrapProblem } from "@/lib/wraps/problem";

export const runtime = "nodejs";

type Params = { params: Promise<{ username: string }> };

export async function POST(request: Request, { params }: Params) {
  return observeRoute(request, "FOLLOW_MUTATION", "PROFILE", (operation) =>
    post(request, { params }, operation),
  );
}

async function post(
  request: Request,
  { params }: Params,
  operation: OperationContext,
) {
  const { username } = await params;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return requestProblem();
  }
  if (!isInput(input)) return requestProblem();

  try {
    const supabase = await createServerSupabaseClient();
    const gate = await requireActiveProfile(supabase, operation, followProblem, {
      auth: "WF-FOLLOW-AUTH",
      participation: "WF-FOLLOW-PARTICIPATION",
      db: "WF-FOLLOW-DATABASE",
    });
    if (!gate.ok) return gate.response;

    const { data, error } = await supabase.rpc("toggle_creator_follow", {
      p_enabled: input.enabled,
      p_username: username,
    });
    if (error) return mapDatabaseError(error.message);
    const result = data?.[0];
    if (!result) return databaseProblem();
    return NextResponse.json(
      {
        following: result.following,
        followerCount: result.follower_count,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return databaseProblem();
  }
}

function isInput(value: unknown): value is { enabled: boolean } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) => key === "enabled") &&
    typeof record.enabled === "boolean"
  );
}

function requestProblem() {
  return followProblem(
    400,
    "WF-FOLLOW-REQUEST",
    "The Follow request is incomplete.",
    "Send one explicit enabled state.",
    "Retry the action from the public Profile.",
  );
}

function mapDatabaseError(message: string) {
  if (message === "follow_auth_required") {
    return followProblem(
      401,
      "WF-FOLLOW-AUTH",
      "Sign in to Follow a Creator.",
      "Follow requires a completed Profile.",
      "Sign in and return to this Profile to continue.",
    );
  }
  if (message === "follow_actor_unavailable") {
    return followProblem(
      403,
      "WF-FOLLOW-PARTICIPATION",
      "Your Profile cannot Follow right now.",
      "Follow requires a completed Active Profile.",
      "Complete or restore your Profile before trying again.",
    );
  }
  if (message === "follow_self") {
    return followProblem(
      403,
      "WF-FOLLOW-SELF",
      "You cannot Follow your own Profile.",
      "A Follow must connect an eligible User to another Creator.",
      "Open another Creator Profile to continue.",
    );
  }
  if (message === "follow_creator_unavailable") {
    return followProblem(
      409,
      "WF-FOLLOW-CREATOR",
      "This Creator is not available for Follow actions.",
      "Only an eligible Creator Profile can receive Follows.",
      "Refresh the Profile and choose another Creator if needed.",
    );
  }
  if (message === "follow_rate_limited") {
    return followProblem(
      429,
      "WF-FOLLOW-RATE",
      "Follow actions are temporarily limited.",
      "At most thirty Follow operations are allowed per User per rolling minute.",
      "Wait before trying another Follow action.",
      { "retry-after": "60" },
    );
  }
  return databaseProblem();
}

function databaseProblem() {
  return followProblem(
    503,
    "WF-FOLLOW-DATABASE",
    "The Follow action could not be recorded safely.",
    "The relationship and public count must commit together.",
    "Retry the same action after the service recovers.",
  );
}

function followProblem(
  status: number,
  code: string,
  problem: string,
  rule: string,
  nextAction: string,
  headers: HeadersInit = {},
) {
  return wrapProblem(status, code, problem, rule, nextAction, headers);
}
