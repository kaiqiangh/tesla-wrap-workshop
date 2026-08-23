import { NextResponse } from "next/server";

import { requireActiveProfile } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { readJsonBody } from "@/lib/request-body";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { wrapProblem } from "@/lib/wraps/problem";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params) {
  return observeRoute(request, "COMMENT_CREATE", "WRAP", (operation) =>
    post(request, { params }, operation),
  );
}

async function post(
  request: Request,
  { params }: Params,
  operation: OperationContext,
) {
  const { slug } = await params;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return requestProblem();
  const input = parsed.body;
  if (!isInput(input)) return requestProblem();

  try {
    const supabase = await createServerSupabaseClient();
    const gate = await requireActiveProfile(
      supabase,
      operation,
      commentProblem,
      {
        auth: "WF-COMMENT-AUTH",
        participation: "WF-COMMENT-PARTICIPATION",
        db: "WF-COMMENT-DATABASE",
      },
    );
    if (!gate.ok) return gate.response;

    const { data, error } = await supabase.rpc("add_wrap_comment", {
      p_body: input.body,
      p_idempotency_key: input.idempotencyKey,
      p_slug: slug,
    });
    if (error) return mapDatabaseError(error.message);
    const result = data?.[0];
    if (!result) return databaseProblem();
    return NextResponse.json(
      {
        comment: {
          id: result.id,
          body: result.body,
          authorUsername: result.author_username,
          authorDisplayName: result.author_display_name,
          createdAt: result.created_at,
          ownedByViewer: true,
        },
        commentCount: result.comment_count,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return databaseProblem();
  }
}

function isInput(value: unknown): value is {
  body: string;
  idempotencyKey: string;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) =>
      ["body", "idempotencyKey"].includes(key),
    ) &&
    typeof record.body === "string" &&
    typeof record.idempotencyKey === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      record.idempotencyKey,
    )
  );
}

function requestProblem() {
  return commentProblem(
    400,
    "WF-COMMENT-REQUEST",
    "The Comment request is incomplete.",
    "Send one plain-text body and one idempotency key.",
    "Retry the Comment from the Published Wrap page.",
  );
}

function mapDatabaseError(message: string) {
  if (message === "comment_auth_required") {
    return commentProblem(
      401,
      "WF-COMMENT-AUTH",
      "Sign in to add a Comment.",
      "Comments require a completed Profile.",
      "Sign in and return to this Wrap to continue.",
    );
  }
  if (message === "comment_actor_unavailable") {
    return commentProblem(
      403,
      "WF-COMMENT-PARTICIPATION",
      "Your Profile cannot add Comments right now.",
      "Comments require a completed Active Profile.",
      "Complete or restore your Profile before trying again.",
    );
  }
  if (message === "comment_wrap_unavailable") {
    return commentProblem(
      409,
      "WF-COMMENT-WRAP",
      "This Wrap is no longer available for Comments.",
      "Only an eligible Published Wrap can receive new Comments.",
      "Refresh the Wrap and choose another Published Wrap if needed.",
    );
  }
  if (
    message === "invalid_comment_request" ||
    message === "comment_idempotency_mismatch"
  ) {
    return requestProblem();
  }
  if (message === "comment_minute_rate_limited") {
    return commentProblem(
      429,
      "WF-COMMENT-RATE",
      "Comments are temporarily limited.",
      "At most five new Comments are allowed per User per rolling minute.",
      "Wait before adding another Comment.",
      { "retry-after": "60" },
    );
  }
  if (message === "comment_hour_rate_limited") {
    return commentProblem(
      429,
      "WF-COMMENT-RATE",
      "Comments are temporarily limited.",
      "At most thirty new Comments are allowed per User per rolling hour.",
      "Wait before adding another Comment.",
      { "retry-after": "3600" },
    );
  }
  return databaseProblem();
}

function databaseProblem() {
  return commentProblem(
    503,
    "WF-COMMENT-DATABASE",
    "The Comment could not be recorded safely.",
    "The Comment, engagement event, and public count must commit together.",
    "Retry the same Comment after the service recovers.",
  );
}

function commentProblem(
  status: number,
  code: string,
  problem: string,
  rule: string,
  nextAction: string,
  headers: HeadersInit = {},
) {
  return wrapProblem(status, code, problem, rule, nextAction, headers);
}
