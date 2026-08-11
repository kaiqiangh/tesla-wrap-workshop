import { NextResponse } from "next/server";

import { readServerEnvironment } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const env = readServerEnvironment(process.env);
  if (
    env.WRAPFORGE_ENVIRONMENT !== "local" &&
    request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`
  )
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Not authorized." } },
      { status: 401, headers: { "cache-control": "no-store" } },
    );

  const admin = createAdminSupabaseClient();
  const { data: jobs, error: claimError } = await admin.rpc(
    "claim_profile_cleanup_jobs",
    { p_limit: 50 },
  );
  if (claimError)
    return NextResponse.json(
      {
        error: {
          code: "profile_cleanup_unavailable",
          message: "Profile cleanup is temporarily unavailable.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  let completed = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    const { data: activeAsset, error: activeAssetError } = await admin
      .from("profile_avatar_assets")
      .select("id")
      .eq("state", "ACTIVE")
      .or(`source_key.eq.${job.object_key},derived_key.eq.${job.object_key}`)
      .maybeSingle();
    if (activeAssetError) {
      await admin.rpc("complete_profile_cleanup_job", {
        p_id: job.id,
        p_success: false,
        p_error: activeAssetError.message,
      });
      failed += 1;
      continue;
    }
    if (activeAsset) {
      await admin.rpc("complete_profile_cleanup_job", {
        p_id: job.id,
        p_success: true,
      });
      completed += 1;
      continue;
    }
    const removed = await admin.storage
      .from(job.bucket_id)
      .remove([job.object_key]);
    const { error: completeError } = await admin.rpc(
      "complete_profile_cleanup_job",
      {
        p_id: job.id,
        p_success: !removed.error,
        p_error: removed.error?.message,
      },
    );
    if (completeError || removed.error) failed += 1;
    else completed += 1;
  }

  return NextResponse.json(
    { completed, failed },
    { headers: { "cache-control": "no-store" } },
  );
}
