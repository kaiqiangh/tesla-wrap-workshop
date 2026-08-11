import { NextResponse } from "next/server";

import {
  observeRoute,
  recordCoreLoopEvent,
  type OperationContext,
} from "@/lib/observability";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export function POST(request: Request) {
  return observeRoute(request, "PAGE_VIEW", "DISCOVERY", (operation) =>
    post(operation),
  );
}

async function post(operation: OperationContext) {
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
