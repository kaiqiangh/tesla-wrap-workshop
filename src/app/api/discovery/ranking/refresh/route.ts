import { NextResponse } from "next/server";

import { readServerEnvironment } from "@/lib/env";
import { observeRoute } from "@/lib/observability";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export function GET(request: Request) {
  return observeRoute(request, "DISCOVERY_RANKING_REFRESH", "DISCOVERY", () =>
    refresh(request),
  );
}

async function refresh(request: Request) {
  let env: ReturnType<typeof readServerEnvironment>;
  try {
    env = readServerEnvironment(process.env);
  } catch {
    return rankingProblem();
  }
  if (
    env.WRAPFORGE_ENVIRONMENT !== "local" &&
    (!env.CRON_SECRET ||
      request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`)
  ) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Not authorized." } },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const { data, error } = await createAdminSupabaseClient().rpc(
      "refresh_discovery_ranking",
    );
    if (error || typeof data !== "string") return rankingProblem();

    return NextResponse.json(
      { calculatedAt: data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return rankingProblem();
  }
}

function rankingProblem() {
  return NextResponse.json(
    {
      error: {
        code: "ranking_refresh_failed",
        message: "Trending could not be refreshed.",
      },
    },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
