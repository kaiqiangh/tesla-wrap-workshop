import { NextResponse } from "next/server";

import { hmacPrincipal, requestNetworkPrincipal } from "@/lib/limits";
import { readServerEnvironment } from "@/lib/env";
import {
  observeRoute,
  recordCoreLoopEvent,
  type OperationContext,
} from "@/lib/observability";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export function POST(request: Request) {
  return observeRoute(request, "PAGE_VIEW", "DISCOVERY", (operation) =>
    post(request, operation),
  );
}

async function post(request: Request, operation: OperationContext) {
  const env = readServerEnvironment(process.env);
  const session = requestCookie(request, "wf_search_session") ?? "missing";
  const admin = createAdminSupabaseClient();
  const { error: limitError } = await admin.rpc("consume_page_view_limit", {
    p_session_principal: hmacPrincipal(
      env.DOWNLOAD_PRINCIPAL_HMAC_SECRET,
      "search",
      session,
    ),
    p_network_principal: hmacPrincipal(
      env.DOWNLOAD_PRINCIPAL_HMAC_SECRET,
      "network",
      requestNetworkPrincipal(request),
    ),
  });
  if (limitError?.message === "page_view_rate_limited") {
    return NextResponse.json(
      { error: { code: "WF-PAGE-VIEW-RATE" } },
      {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": "60" },
      },
    );
  }
  if (limitError) {
    return NextResponse.json(
      { error: { code: "WF-PAGE-VIEW-DATABASE" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const client = await createServerSupabaseClient();
    const viewer = await client.auth.getUser();
    operation.actorId = viewer.data.user?.id;
  } catch {
    // Anonymous page views remain durable without an actor identifier.
  }
  const recorded = await recordCoreLoopEvent({
    eventKind: "PAGE_VIEW",
    actorId: operation.actorId,
    targetType: "DISCOVERY",
    targetId: "00000000-0000-4000-8000-000000000000",
    outcome: "SUCCESS",
    code: "PAGE_VIEW",
    correlationId: operation.correlationId,
  });
  if (!recorded) {
    return NextResponse.json(
      { error: { code: "WF-PAGE-VIEW-DATABASE" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );
}

function requestCookie(request: Request, name: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
