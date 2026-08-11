import { NextResponse } from "next/server";

import { searchDiscoveryWraps } from "@/lib/discovery";
import { parseDiscoveryQuery } from "../../../../lib/discovery-query";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export function GET(request: Request) {
  return observeRoute(request, "DISCOVERY_SEARCH", "WRAP", (operation) =>
    get(request, operation),
  );
}

async function get(request: Request, operation: OperationContext) {
  const query = parseDiscoveryQuery(new URL(request.url).searchParams);
  if (!query) {
    return NextResponse.json(
      { error: { code: "WF-DISCOVERY-REQUEST" } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  let result: Awaited<ReturnType<typeof searchDiscoveryWraps>>;
  try {
    const client = await createServerSupabaseClient();
    try {
      const viewer = await client.auth.getUser();
      operation.actorId = viewer.data.user?.id;
    } catch {
      // Search remains available when the optional viewer lookup is unavailable.
    }
    result = await searchDiscoveryWraps(client, {
      q: query.q,
      modelSlug: query.model,
      variantKey: query.variant,
      sort: query.sort,
      cursor: query.cursor,
    });
  } catch {
    return NextResponse.json(
      { error: { code: "WF-DISCOVERY-DATABASE" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (result.status === "rate_limited") {
    return NextResponse.json(
      { error: { code: "WF-DISCOVERY-RATE" } },
      {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": "60" },
      },
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json(
      { error: { code: "WF-DISCOVERY-REQUEST" } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  if (result.status === "error") {
    return NextResponse.json(
      { error: { code: "WF-DISCOVERY-DATABASE" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
