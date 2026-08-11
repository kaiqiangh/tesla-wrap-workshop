import { NextResponse } from "next/server";

import { readServerEnvironment } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const sha = safeSha(
    process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
      process.env.GIT_COMMIT_SHA,
  );
  let env: ReturnType<typeof readServerEnvironment>;
  try {
    env = readServerEnvironment(process.env);
  } catch {
    return healthResponse(503, sha, "unknown", false);
  }
  try {
    const { error } = await createAdminSupabaseClient()
      .from("core_loop_events")
      .select("id", { count: "exact", head: true });
    if (error) {
      return healthResponse(503, sha, env.WRAPFORGE_ENVIRONMENT, false);
    }
    return healthResponse(200, sha, env.WRAPFORGE_ENVIRONMENT, true);
  } catch {
    return healthResponse(503, sha, env.WRAPFORGE_ENVIRONMENT, false);
  }
}

function healthResponse(
  status: number,
  sha: string,
  environment: string,
  migrationReady: boolean,
) {
  return NextResponse.json(
    {
      status: migrationReady ? "ready" : "not_ready",
      sha,
      environment,
      migrationReady,
    },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );
}

function safeSha(value: string | undefined) {
  return value && /^[0-9a-f]{7,64}$/i.test(value) ? value : "unknown";
}
