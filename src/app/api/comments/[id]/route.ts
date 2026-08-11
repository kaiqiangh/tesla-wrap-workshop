import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { wrapProblem } from "@/lib/wraps/problem";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  return observeRoute(_request, "COMMENT_DELETE", "WRAP", (operation) =>
    removeComment({ params }, operation),
  );
}

async function removeComment({ params }: Params, operation: OperationContext) {
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    return commentProblem(
      400,
      "WF-COMMENT-REQUEST",
      "The Comment identifier is invalid.",
      "Delete requires a valid Comment identifier.",
      "Refresh the Wrap and try again.",
    );
  }

  try {
    const supabase = await createServerSupabaseClient();
    const access = await readProfileAccess(supabase);
    if (access.status === "guest") {
      return commentProblem(
        401,
        "WF-COMMENT-AUTH",
        "Sign in to delete your Comment.",
        "Comment deletion requires a completed Profile.",
        "Sign in and return to this Wrap to continue.",
      );
    }
    operation.actorId = access.userId;
    if (access.status !== "active") {
      return commentProblem(
        403,
        "WF-COMMENT-PARTICIPATION",
        "Your Profile cannot delete Comments right now.",
        "Comment deletion requires a completed Active Profile.",
        "Restore your Profile before trying again.",
      );
    }
    const { data, error } = await supabase.rpc("remove_wrap_comment", {
      p_comment_id: id,
    });
    if (error) return mapDatabaseError(error.message);
    const result = data?.[0];
    if (!result) return databaseProblem();
    return NextResponse.json(
      {
        id: result.id,
        removed: result.removed,
        commentCount: result.comment_count,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return databaseProblem();
  }
}

function mapDatabaseError(message: string) {
  if (message === "comment_auth_required") {
    return commentProblem(
      401,
      "WF-COMMENT-AUTH",
      "Sign in to delete your Comment.",
      "Comment deletion requires a completed Profile.",
      "Sign in and return to this Wrap to continue.",
    );
  }
  if (message === "comment_actor_unavailable") {
    return commentProblem(
      403,
      "WF-COMMENT-PARTICIPATION",
      "Your Profile cannot delete Comments right now.",
      "Comment deletion requires a completed Active Profile.",
      "Restore your Profile before trying again.",
    );
  }
  if (message === "comment_not_owner") {
    return commentProblem(
      403,
      "WF-COMMENT-OWNER",
      "You can delete only your own Comment.",
      "Comment ownership is checked by the database.",
      "Choose one of your own Comments to delete.",
    );
  }
  if (message === "comment_unavailable") {
    return commentProblem(
      409,
      "WF-COMMENT-UNAVAILABLE",
      "This Comment is no longer available.",
      "Hidden and unavailable Comments cannot be changed through public flows.",
      "Refresh the Wrap to see the current conversation.",
    );
  }
  if (message === "comment_wrap_unavailable") {
    return commentProblem(
      409,
      "WF-COMMENT-WRAP",
      "This Wrap is no longer available for Comments.",
      "Only an eligible Published Wrap can receive Comment changes.",
      "Refresh the Wrap and try again if it is Published.",
    );
  }
  return databaseProblem();
}

function databaseProblem() {
  return commentProblem(
    503,
    "WF-COMMENT-DATABASE",
    "The Comment could not be removed safely.",
    "Comment state, engagement evidence, and public count must commit together.",
    "Retry the same deletion after the service recovers.",
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
