import "server-only";

import { hmacPrincipal } from "./limits";
import { readServerEnvironment } from "./env";
import { createAdminSupabaseClient } from "./supabase/admin";

type TargetType =
  "AUTH" | "UPLOAD" | "WRAP" | "DOWNLOAD" | "PROFILE" | "MODERATION";
type OperationOutcome = "success" | "denied" | "error";

export type OperationContext = {
  correlationId: string;
  action: string;
  targetType: TargetType;
  startedAt: number;
  actorId?: string;
  targetId?: string;
};

export function beginOperation(
  request: Request,
  action: string,
  targetType: TargetType,
): OperationContext {
  const supplied = request.headers.get("x-correlation-id")?.trim();
  return {
    correlationId: isUuid(supplied) ? supplied : crypto.randomUUID(),
    action: safeToken(action, "UNKNOWN_ACTION"),
    targetType,
    startedAt: performance.now(),
  };
}

export async function observeRoute<T extends Response>(
  request: Request,
  action: string,
  targetType: TargetType,
  handler: (context: OperationContext) => Promise<T>,
): Promise<T> {
  const context = beginOperation(request, action, targetType);
  try {
    const response = await handler(context);
    return await finishOperation(response, context);
  } catch {
    logOperation(context, "error", "INTERNAL_ERROR");
    const response = new Response(
      JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "The request could not be completed right now.",
        },
      }),
      {
        status: 500,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
          "x-correlation-id": context.correlationId,
        },
      },
    );
    return response as T;
  }
}

export async function finishOperation<T extends Response>(
  response: T,
  context: OperationContext,
): Promise<T> {
  let code: string | undefined;
  try {
    const payload = await response.clone().json();
    const candidate = payload?.error?.code;
    if (typeof candidate === "string") code = candidate;
  } catch {
    // Non-JSON success responses still receive a stable HTTP code.
  }
  const outcome: OperationOutcome =
    response.status >= 500
      ? "error"
      : response.status >= 400
        ? "denied"
        : "success";
  logOperation(context, outcome, safeToken(code, `HTTP_${response.status}`));
  try {
    response.headers.set("x-correlation-id", context.correlationId);
  } catch {
    // A platform response may expose immutable headers; logging still holds.
  }
  return response;
}

export function logOperation(
  context: OperationContext,
  outcome: OperationOutcome,
  code: string,
) {
  let environment = "unknown";
  try {
    environment = readServerEnvironment(process.env).WRAPFORGE_ENVIRONMENT;
  } catch {
    environment = process.env.WRAPFORGE_ENVIRONMENT?.trim() || "unknown";
  }
  const secret = process.env.DOWNLOAD_PRINCIPAL_HMAC_SECRET;
  const actor = context.actorId
    ? secret && secret.length >= 32
      ? hmacPrincipal(secret, "actor", context.actorId)
      : "user:present"
    : "guest";
  const payload = {
    type: "wrapforge.operation",
    timestamp: new Date().toISOString(),
    environment,
    sha: safeSha(
      process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
        process.env.GIT_COMMIT_SHA,
    ),
    correlationId: context.correlationId,
    actor,
    action: safeToken(context.action, "UNKNOWN_ACTION"),
    targetType: context.targetType,
    outcome,
    code: safeToken(code, "INTERNAL_ERROR"),
    durationMs: Math.max(0, Math.round(performance.now() - context.startedAt)),
  };
  const line = JSON.stringify(payload);
  if (outcome === "success") console.info(line);
  else if (outcome === "denied") console.warn(line);
  else console.error(line);
}

export async function recordCoreLoopEvent(input: {
  eventKind: string;
  actorId?: string | null;
  principalKind?: "GUEST" | "USER" | null;
  principalHash?: string | null;
  targetType: "USER" | "PROFILE" | "PENDING_UPLOAD" | "ASSET_REVISION" | "WRAP";
  targetId: string;
  outcome: "SUCCESS" | "DUPLICATE" | "FAILURE";
  code: string;
  counted?: boolean | null;
  correlationId?: string | null;
}) {
  try {
    const { data, error } = await createAdminSupabaseClient().rpc(
      "record_core_loop_event",
      {
        p_event_kind: input.eventKind,
        p_actor_id: input.actorId ?? null,
        p_principal_kind: input.principalKind ?? null,
        p_principal_hash: input.principalHash ?? null,
        p_target_type: input.targetType,
        p_target_id: input.targetId,
        p_outcome: input.outcome,
        p_code: input.code,
        p_counted: input.counted ?? null,
        p_correlation_id: input.correlationId ?? null,
      },
    );
    return !error && typeof data === "string";
  } catch {
    return false;
  }
}

function isUuid(value: string | undefined): value is string {
  return (
    !!value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function safeSha(value: string | undefined) {
  return value && /^[0-9a-f]{7,64}$/i.test(value) ? value : "unknown";
}

function safeToken(value: string | undefined, fallback: string) {
  return value && /^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(value) ? value : fallback;
}
