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
  const { data: coreLoopEventsDeleted, error: coreLoopEventsError } =
    await admin.rpc("cleanup_core_loop_events");
  if (coreLoopEventsError)
    return NextResponse.json(
      {
        error: {
          code: "core_loop_event_cleanup_unavailable",
          message: "Core-loop event cleanup is temporarily unavailable.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  const { data: anonymized, error: anonymizeError } = await admin.rpc(
    "anonymize_expired_profiles",
    { p_limit: 50 },
  );
  if (anonymizeError)
    return NextResponse.json(
      {
        error: {
          code: "profile_anonymization_unavailable",
          message: "Profile anonymization is temporarily unavailable.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  const { data: assetJobs, error: assetClaimError } = await admin.rpc(
    "claim_asset_cleanup_jobs",
    { p_limit: 50 },
  );
  if (assetClaimError)
    return NextResponse.json(
      {
        error: {
          code: "asset_cleanup_unavailable",
          message: "Asset cleanup is temporarily unavailable.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  let assetCompleted = 0;
  let assetFailed = 0;
  for (const job of assetJobs ?? []) {
    const removed = await admin.storage
      .from(job.bucket_id)
      .remove([job.object_key]);
    const { error: completeError } = await admin.rpc(
      "complete_asset_cleanup_job",
      {
        p_id: job.id,
        p_success: !removed.error,
        p_error: removed.error?.message,
      },
    );
    if (completeError || removed.error) assetFailed += 1;
    else assetCompleted += 1;
  }

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
      const { error: completeError } = await admin.rpc(
        "complete_profile_cleanup_job",
        {
          p_id: job.id,
          p_success: true,
        },
      );
      if (completeError) failed += 1;
      else completed += 1;
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

  const { data: wrapJobs, error: wrapClaimError } = await admin.rpc(
    "claim_profile_wrap_cleanup_jobs",
    { p_limit: 50 },
  );
  if (wrapClaimError)
    return NextResponse.json(
      {
        error: {
          code: "profile_wrap_cleanup_unavailable",
          message: "Wrap cleanup is temporarily unavailable.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  let wrapCompleted = 0;
  let wrapFailed = 0;
  for (const job of wrapJobs ?? []) {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("participation_state")
      .eq("user_id", job.profile_id)
      .maybeSingle();
    if (profileError) {
      await admin.rpc("complete_profile_wrap_cleanup_job", {
        p_id: job.id,
        p_success: false,
        p_error: profileError.message,
      });
      wrapFailed += 1;
      continue;
    }
    if (profile?.participation_state === "ACTIVE") {
      const { error: completeError } = await admin.rpc(
        "complete_profile_wrap_cleanup_job",
        { p_id: job.id, p_success: true },
      );
      if (completeError) wrapFailed += 1;
      else wrapCompleted += 1;
      continue;
    }
    const removed = await admin.storage
      .from(job.bucket_id)
      .remove([job.object_key]);
    const { error: completeError } = await admin.rpc(
      "complete_profile_wrap_cleanup_job",
      {
        p_id: job.id,
        p_success: !removed.error,
        p_error: removed.error?.message,
      },
    );
    if (completeError || removed.error) wrapFailed += 1;
    else wrapCompleted += 1;
  }

  return NextResponse.json(
    {
      anonymized: anonymized ?? 0,
      coreLoopEventsDeleted: coreLoopEventsDeleted ?? 0,
      assetCompleted,
      assetFailed,
      completed,
      failed,
      wrapCompleted,
      wrapFailed,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
