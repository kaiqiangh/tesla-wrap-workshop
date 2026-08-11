import { NextResponse } from "next/server";

import { readServerEnvironment } from "@/lib/env";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export function GET(request: Request) {
  return observeRoute(
    request,
    "RECONCILIATION_CLEANUP",
    "MODERATION",
    (operation) => cleanup(request, operation),
  );
}

async function cleanup(request: Request, operation: OperationContext) {
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
  const { error: expiryError } = await admin.rpc("expire_pending_uploads", {
    p_limit: 200,
  });
  if (expiryError)
    return NextResponse.json(
      {
        error: {
          code: "pending_upload_expiry_unavailable",
          message: "Pending Upload expiry is temporarily unavailable.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
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

  const { error: revisionReconcileError } = await admin.rpc(
    "reconcile_asset_revision_cleanup",
    { p_limit: 100 },
  );
  if (revisionReconcileError)
    return NextResponse.json(
      {
        error: {
          code: "asset_revision_reconcile_unavailable",
          message: "Asset Revision reconciliation is temporarily unavailable.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  const { data: revisionJobs, error: revisionClaimError } = await admin.rpc(
    "claim_asset_revision_cleanup_jobs",
    { p_limit: 50 },
  );
  if (revisionClaimError)
    return NextResponse.json(
      {
        error: {
          code: "asset_revision_cleanup_unavailable",
          message: "Asset Revision cleanup is temporarily unavailable.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  let revisionCompleted = 0;
  let revisionFailed = 0;
  for (const job of revisionJobs ?? []) {
    const removed = await admin.storage
      .from(job.bucket_id)
      .remove([job.object_key]);
    const { error: completeError } = await admin.rpc(
      "complete_asset_revision_cleanup_job",
      {
        p_id: job.id,
        p_success: !removed.error,
        p_error: removed.error?.message,
      },
    );
    if (completeError || removed.error) revisionFailed += 1;
    else revisionCompleted += 1;
  }

  const { data: orphanJobs, error: orphanClaimError } = await admin.rpc(
    "claim_asset_orphan_cleanup_jobs",
    { p_limit: 50 },
  );
  if (orphanClaimError)
    return NextResponse.json(
      {
        error: {
          code: "asset_orphan_cleanup_unavailable",
          message: "Orphaned asset cleanup is temporarily unavailable.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  let orphanCompleted = 0;
  let orphanFailed = 0;
  for (const job of orphanJobs ?? []) {
    const { data: referenced, error: referenceError } = await admin
      .from("wrap_assets")
      .select("id")
      .eq("bucket_id", job.bucket_id)
      .eq("object_key", job.object_key)
      .maybeSingle();
    if (referenceError) {
      await admin.rpc("complete_asset_orphan_cleanup_job", {
        p_id: job.id,
        p_success: false,
        p_error: referenceError.message,
      });
      orphanFailed += 1;
      continue;
    }
    if (referenced) {
      const { error: completeError } = await admin.rpc(
        "complete_asset_orphan_cleanup_job",
        { p_id: job.id, p_success: true },
      );
      if (completeError) orphanFailed += 1;
      else orphanCompleted += 1;
      continue;
    }
    const removed = await admin.storage
      .from(job.bucket_id)
      .remove([job.object_key]);
    const { error: completeError } = await admin.rpc(
      "complete_asset_orphan_cleanup_job",
      {
        p_id: job.id,
        p_success: !removed.error,
        p_error: removed.error?.message,
      },
    );
    if (completeError || removed.error) orphanFailed += 1;
    else orphanCompleted += 1;
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

  const failures =
    assetFailed + revisionFailed + orphanFailed + failed + wrapFailed;
  const result = {
    anonymized: anonymized ?? 0,
    coreLoopEventsDeleted: coreLoopEventsDeleted ?? 0,
    assetCompleted,
    assetFailed,
    revisionCompleted,
    revisionFailed,
    orphanCompleted,
    orphanFailed,
    completed,
    failed,
    wrapCompleted,
    wrapFailed,
  };
  if (failures > 0) {
    console.error(
      JSON.stringify({
        type: "wrapforge.reconciliation_alert",
        code: "RECONCILIATION_FAILURE",
        correlationId: operation.correlationId,
        failures,
        runbook: "/runbooks/reconciliation.md",
      }),
    );
    return NextResponse.json(
      {
        error: {
          code: "WF-RECONCILIATION-ALERT",
          message: "Reconciliation requires attention.",
          runbook: "/runbooks/reconciliation.md",
        },
        ...result,
      },
      {
        status: 503,
        headers: { "cache-control": "no-store", "retry-after": "300" },
      },
    );
  }
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
