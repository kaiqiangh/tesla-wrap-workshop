import { NextResponse } from "next/server";

import { requireActiveProfile } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { wrapProblem } from "@/lib/wraps/problem";

export const runtime = "nodejs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"]);
const ACTIONS = new Set([
  "REVIEW",
  "RESOLVE",
  "DISMISS",
  "HIDE",
  "REMOVE",
  "SUSPEND",
  "DEACTIVATE",
  "REINSTATE",
]);
const REASONS = new Set([
  "COPYRIGHT",
  "OFFENSIVE_CONTENT",
  "SPAM",
  "STOLEN_CONTENT",
  "WRONG_VEHICLE_OR_TEMPLATE",
  "INVALID_DOWNLOAD",
  "OTHER",
  "NO_VIOLATION",
  "DUPLICATE",
  "RESTORED",
]);
const OUTCOMES = new Set([
  "NO_ACTION",
  "CONTENT_HIDDEN",
  "CONTENT_REMOVED",
  "USER_SUSPENDED",
  "USER_DEACTIVATED",
  "DUPLICATE",
]);

export function GET(request: Request) {
  return observeRoute(
    request,
    "ADMIN_REPORT_QUEUE",
    "MODERATION",
    (operation) => get(request, operation),
  );
}

async function get(request: Request, operation: OperationContext) {
  try {
    const supabase = await createServerSupabaseClient();
    const gate = await requireActiveProfile(supabase, operation, adminProblem, {
      auth: "WF-ADMIN-AUTH",
      participation: "WF-ADMIN-DENIED",
      db: "WF-ADMIN-DATABASE",
    });
    if (!gate.ok) return gate.response;
    const value = new URL(request.url).searchParams.get("status");
    const status = value ? value.toUpperCase() : null;
    if (status && !STATUSES.has(status)) {
      return adminProblem(
        400,
        "WF-ADMIN-REQUEST",
        "The queue status is invalid.",
        "Queue filters must use OPEN, REVIEWING, RESOLVED, or DISMISSED.",
        "Choose one supported queue status.",
      );
    }
    const { data, error } = await supabase.rpc("list_admin_reports", {
      p_status: status ?? undefined,
    });
    if (error) return mapDatabaseError(error.message);
    return NextResponse.json(
      { reports: (data ?? []).map(toReport) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return databaseProblem();
  }
}

export function POST(request: Request) {
  return observeRoute(request, "ADMIN_MODERATION", "MODERATION", (operation) =>
    post(request, operation),
  );
}

async function post(request: Request, operation: OperationContext) {
  if (!sameOriginRequest(request)) {
    return adminProblem(
      403,
      "WF-ADMIN-CSRF",
      "This moderation request did not come from the WrapForge site.",
      "State-changing moderation actions require a same-origin request.",
      "Retry the action from the private moderation queue.",
    );
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return requestProblem();
  }
  if (!isInput(input)) return requestProblem();

  try {
    const supabase = await createServerSupabaseClient();
    const gate = await requireActiveProfile(supabase, operation, adminProblem, {
      auth: "WF-ADMIN-AUTH",
      participation: "WF-ADMIN-DENIED",
      db: "WF-ADMIN-DATABASE",
    });
    if (!gate.ok) return gate.response;
    const { data, error } = await supabase.rpc("moderate_report", {
      p_report_id: input.reportId,
      p_action_kind: input.actionKind,
      p_reason: input.reason,
      p_private_note: input.privateNote ?? "",
      p_outcome_category: input.outcomeCategory ?? "",
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) return mapDatabaseError(error.message);
    const result = data?.[0];
    if (!result) return databaseProblem();
    return NextResponse.json(
      {
        moderation: {
          reportId: result.report_id,
          reportStatus: result.report_status,
          outcomeCategory: result.outcome_category,
          actionId: result.action_id,
          actionCreated: result.action_created,
          targetKind: result.target_kind,
          targetId: result.target_id,
          targetState: result.target_state,
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return databaseProblem();
  }
}

function isInput(value: unknown): value is {
  reportId: string;
  actionKind: string;
  reason: string;
  privateNote?: string | null;
  outcomeCategory?: string | null;
  idempotencyKey: string;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    !Object.keys(record).every((key) =>
      [
        "reportId",
        "actionKind",
        "reason",
        "privateNote",
        "outcomeCategory",
        "idempotencyKey",
      ].includes(key),
    )
  ) {
    return false;
  }
  return (
    typeof record.reportId === "string" &&
    UUID.test(record.reportId) &&
    typeof record.actionKind === "string" &&
    ACTIONS.has(record.actionKind.toUpperCase()) &&
    typeof record.reason === "string" &&
    REASONS.has(record.reason.toUpperCase()) &&
    typeof record.idempotencyKey === "string" &&
    UUID.test(record.idempotencyKey) &&
    (record.privateNote === undefined ||
      record.privateNote === null ||
      (typeof record.privateNote === "string" &&
        record.privateNote.length <= 2000)) &&
    (record.outcomeCategory === undefined ||
      record.outcomeCategory === null ||
      (typeof record.outcomeCategory === "string" &&
        OUTCOMES.has(record.outcomeCategory.toUpperCase())))
  );
}

function toReport(result: {
  id: string;
  target_kind: string;
  target_id: string;
  target_ref: string;
  target_summary: string | null;
  target_state: string | null;
  reporter_ref: string;
  reason: string;
  detail: string | null;
  status: string;
  outcome_category: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  last_action_kind: string | null;
  last_action_reason: string | null;
  last_action_at: string | null;
}) {
  return {
    id: result.id,
    targetKind: result.target_kind,
    targetId: result.target_id,
    targetRef: result.target_ref,
    targetSummary: result.target_summary,
    targetState: result.target_state,
    reporterRef: result.reporter_ref,
    reason: result.reason,
    detail: result.detail,
    status: result.status,
    outcomeCategory: result.outcome_category,
    adminNote: result.admin_note,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
    resolvedAt: result.resolved_at,
    lastActionKind: result.last_action_kind,
    lastActionReason: result.last_action_reason,
    lastActionAt: result.last_action_at,
  };
}

function requestProblem() {
  return adminProblem(
    400,
    "WF-ADMIN-REQUEST",
    "The moderation request is invalid.",
    "Use one Report, supported action and reason, bounded note, outcome, and UUID idempotency key.",
    "Review the queue action and retry.",
  );
}

function mapDatabaseError(message: string) {
  if (message === "admin_required") {
    return adminProblem(
      403,
      "WF-ADMIN-DENIED",
      "This account is not a current administrator.",
      "Every moderation request rechecks ADMIN membership in the database.",
      "Ask an administrator owner to grant current access.",
    );
  }
  if (message === "admin_report_not_found") {
    return adminProblem(
      404,
      "WF-ADMIN-REPORT",
      "This Report is no longer available.",
      "Queue actions use a fresh Report row and target state.",
      "Refresh the moderation queue.",
    );
  }
  if (
    message === "moderation_conflict" ||
    message === "admin_target_unavailable"
  ) {
    return adminProblem(
      409,
      "WF-ADMIN-CONFLICT",
      "The target changed before moderation could commit.",
      "Moderation refuses stale or contradictory target transitions.",
      "Refresh the queue and review the current target state.",
    );
  }
  if (message === "moderation_idempotency_mismatch") {
    return adminProblem(
      409,
      "WF-ADMIN-IDEMPOTENCY",
      "This retry key belongs to a different moderation action.",
      "A moderation retry must repeat the original Report, action, reason, and note.",
      "Generate a new action only after reviewing the current queue state.",
    );
  }
  if (message === "moderation_rate_limited") {
    return adminProblem(
      429,
      "WF-ADMIN-RATE",
      "The moderation action limit has been reached.",
      "Each administrator may commit at most ten moderation actions per rolling hour.",
      "Wait before retrying the same queue action.",
      { "retry-after": "3600" },
    );
  }
  if (
    message === "invalid_moderation_status" ||
    message === "invalid_moderation_request" ||
    message === "invalid_moderation_outcome" ||
    message === "invalid_moderation_target_action"
  ) {
    return requestProblem();
  }
  return databaseProblem();
}

function databaseProblem() {
  return adminProblem(
    503,
    "WF-ADMIN-DATABASE",
    "The moderation change could not be recorded safely.",
    "Report state, target state, and append-only audit evidence must commit together.",
    "Retry the same action after the service recovers.",
  );
}

function adminProblem(
  status: number,
  code: string,
  problem: string,
  rule: string,
  nextAction: string,
  headers: HeadersInit = {},
) {
  return wrapProblem(status, code, problem, rule, nextAction, headers);
}

function sameOriginRequest(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestHost = request.headers.get("host");
    const originUrl = new URL(origin);
    return requestHost
      ? originUrl.host === requestHost
      : originUrl.origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
