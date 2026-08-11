import { NextResponse } from "next/server";

import { readServerEnvironment } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const env = readServerEnvironment(process.env);
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

  const { data, error } = await createAdminSupabaseClient().rpc(
    "refresh_discovery_ranking",
  );
  if (error || typeof data !== "string") {
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

  return NextResponse.json(
    { calculatedAt: data },
    { headers: { "cache-control": "no-store" } },
  );
}
