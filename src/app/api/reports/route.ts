import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { wrapProblem } from "@/lib/wraps/problem";

export const runtime = "nodejs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_KINDS = new Set(["WRAP", "COMMENT", "USER"]);
const REASONS = new Set([
  "COPYRIGHT",
  "OFFENSIVE_CONTENT",
  "SPAM",
  "STOLEN_CONTENT",
  "WRONG_VEHICLE_OR_TEMPLATE",
  "INVALID_DOWNLOAD",
  "OTHER",
]);

type ReportInput = {
  targetKind: string;
  target: string;
  reason: string;
  detail?: string | null;
  idempotencyKey: string;
};

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return reportProblem(
      400,
      "WF-REPORT-REQUEST",
      "The Report request is incomplete.",
      "Send one target, canonical reason, and idempotency key.",
      "Retry the Report from the public target page.",
    );
  }
  if (!isInput(input)) {
    return reportProblem(
      400,
      "WF-REPORT-REQUEST",
      "The Report request is invalid.",
      "Use one supported target, reason, optional plain-text detail, and UUID idempotency key.",
      "Retry the Report from the public target page.",
    );
  }

  try {
    const supabase = await createServerSupabaseClient();
    const access = await readProfileAccess(supabase);
    if (access.status === "guest") {
      return reportProblem(
        401,
        "WF-REPORT-AUTH",
        "Sign in to submit a Report.",
        "Reports require a completed Profile.",
        "Sign in and return to this target to continue.",
      );
    }
    if (access.status !== "active") {
      return reportProblem(
        403,
        "WF-REPORT-PARTICIPATION",
        "Your Profile cannot submit Reports right now.",
        "Reports require a completed Active Profile.",
        "Complete or restore your Profile before trying again.",
      );
    }

    const { data, error } = await supabase.rpc("create_report", {
      p_target_kind: input.targetKind,
      p_target: input.target,
      p_reason: input.reason,
      p_detail: input.detail ?? "",
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) return mapDatabaseError(error.message);
    const result = data?.[0];
    if (!result) return databaseProblem();
    return NextResponse.json(
      { report: toReport(result) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return databaseProblem();
  }
}

function isInput(value: unknown): value is ReportInput {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    !Object.keys(record).every((key) =>
      ["targetKind", "target", "reason", "detail", "idempotencyKey"].includes(
        key,
      ),
    )
  ) {
    return false;
  }
  if (
    typeof record.targetKind !== "string" ||
    !TARGET_KINDS.has(record.targetKind.toUpperCase()) ||
    typeof record.target !== "string" ||
    record.target.trim().length < 1 ||
    record.target.trim().length > 120 ||
    typeof record.reason !== "string" ||
    !REASONS.has(record.reason.toUpperCase()) ||
    typeof record.idempotencyKey !== "string" ||
    !UUID.test(record.idempotencyKey)
  ) {
    return false;
  }
  return (
    record.detail === undefined ||
    record.detail === null ||
    (typeof record.detail === "string" && record.detail.length <= 1000)
  );
}

function toReport(result: {
  id: string;
  target_kind: string;
  target_id: string;
  reason: string;
  detail: string | null;
  status: string;
  outcome_category: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  created: boolean;
}) {
  return {
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
    created: result.created,
  };
}

function mapDatabaseError(message: string) {
  if (message === "report_auth_required") {
    return reportProblem(
      401,
      "WF-REPORT-AUTH",
      "Sign in to submit a Report.",
      "Reports require a completed Profile.",
      "Sign in and return to this target to continue.",
    );
  }
  if (message === "report_actor_unavailable") {
    return reportProblem(
      403,
      "WF-REPORT-PARTICIPATION",
      "Your Profile cannot submit Reports right now.",
      "Reports require a completed Active Profile.",
      "Complete or restore your Profile before trying again.",
    );
  }
  if (message === "report_self_target") {
    return reportProblem(
      409,
      "WF-REPORT-SELF",
      "You cannot Report your own content or Profile.",
      "A Report must identify another eligible community target.",
      "Choose another target if there is a genuine concern.",
    );
  }
  if (message === "report_target_unavailable") {
    return reportProblem(
      409,
      "WF-REPORT-TARGET",
      "This target is no longer available for Reports.",
      "Reports can target only publicly eligible Wraps, Comments, and Profiles.",
      "Refresh the page and choose another public target if needed.",
    );
  }
  if (message === "invalid_report_request") {
    return reportProblem(
      400,
      "WF-REPORT-REQUEST",
      "The Report request is invalid.",
      "Use one supported target, canonical reason, optional plain-text detail, and UUID idempotency key.",
      "Retry the Report from the public target page.",
    );
  }
  if (message === "report_idempotency_mismatch") {
    return reportProblem(
      409,
      "WF-REPORT-IDEMPOTENCY",
      "This Report retry does not match its original request.",
      "One idempotency key must represent one exact Report request.",
      "Start a new Report if the target or reason changed.",
    );
  }
  if (message === "report_hour_rate_limited") {
    return reportProblem(
      429,
      "WF-REPORT-RATE",
      "Reports are temporarily limited.",
      "At most five new Reports are allowed per User per rolling hour.",
      "Wait before submitting another Report.",
      { "retry-after": "3600" },
    );
  }
  if (message === "report_day_rate_limited") {
    return reportProblem(
      429,
      "WF-REPORT-RATE",
      "Reports are temporarily limited.",
      "At most twenty new Reports are allowed per User per rolling day.",
      "Wait before submitting another Report.",
      { "retry-after": "86400" },
    );
  }
  return databaseProblem();
}

function databaseProblem() {
  return reportProblem(
    503,
    "WF-REPORT-DATABASE",
    "The Report could not be recorded safely.",
    "The Report and its privacy boundary must commit together.",
    "Retry the same Report after the service recovers.",
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
