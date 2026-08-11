import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { wrapProblem } from "@/lib/wraps/problem";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: Params) {
  return observeRoute(
    _request,
    "REPORT_STATUS_READ",
    "MODERATION",
    (operation) => getReport({ params }, operation),
  );
}

async function getReport({ params }: Params, operation: OperationContext) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return reportProblem(
      400,
      "WF-REPORT-REQUEST",
      "The Report identifier is invalid.",
      "A status read requires a valid Report identifier.",
      "Use the identifier returned when the Report was submitted.",
    );
  }
  try {
    const supabase = await createServerSupabaseClient();
    const access = await readProfileAccess(supabase);
    if (access.status === "guest") {
      return reportProblem(
        401,
        "WF-REPORT-AUTH",
        "Sign in to view this Report receipt.",
        "Report receipts are private to their reporter.",
        "Sign in and return to the Report receipt.",
      );
    }
    operation.actorId = access.userId;
    if (access.status !== "active") {
      return reportProblem(
        403,
        "WF-REPORT-PARTICIPATION",
        "Your Profile cannot view Report receipts right now.",
        "Report receipts require a completed Active Profile.",
        "Restore your Profile before viewing this receipt.",
      );
    }
    const { data, error } = await supabase.rpc("get_my_report", {
      p_report_id: id,
    });
    if (error) return databaseProblem();
    const result = data?.[0];
    if (!result) {
      return reportProblem(
        404,
        "WF-REPORT-NOT-FOUND",
        "This Report receipt is unavailable.",
        "Only the reporter can read a Report receipt.",
        "Return to the public target page.",
      );
    }
    return NextResponse.json(
      {
        report: {
          id: result.id,
          targetKind: result.target_kind,
          targetId: result.target_id,
          reason: result.reason,
          detail: result.detail,
          status: result.status,
          outcomeCategory: result.outcome_category,
          createdAt: result.created_at,
          updatedAt: result.updated_at,
          resolvedAt: result.resolved_at,
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return databaseProblem();
  }
}

function databaseProblem() {
  return reportProblem(
    503,
    "WF-REPORT-DATABASE",
    "The Report receipt could not be read safely.",
    "Private Report status must be read through its reporter-scoped boundary.",
    "Retry the same status request after the service recovers.",
  );
}

function reportProblem(
  status: number,
  code: string,
  problem: string,
  rule: string,
  nextAction: string,
  headers: HeadersInit = {},
) {
  return wrapProblem(status, code, problem, rule, nextAction, headers);
}
