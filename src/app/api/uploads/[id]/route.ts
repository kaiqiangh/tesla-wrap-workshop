import { NextResponse } from "next/server";

import { requireActiveProfile } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { uploadProblem } from "@/lib/upload/problem";

export const runtime = "nodejs";

export function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return observeRoute(request, "UPLOAD_RELEASE", "UPLOAD", (operation) =>
    remove({ params }, operation),
  );
}

async function remove(
  { params }: { params: Promise<{ id: string }> },
  operation: OperationContext,
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return notFound();

  const supabase = await createServerSupabaseClient();
  const gate = await requireActiveProfile(supabase, operation, uploadProblem, {
    auth: "WF-UPLOAD-AUTH",
    participation: "WF-UPLOAD-PARTICIPATION",
    db: "WF-UPLOAD-DATABASE",
  });
  if (!gate.ok) return gate.response;
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("get_pending_upload_for_owner", {
    p_id: id,
    p_owner: gate.userId,
  });
  const pending = data?.[0];
  if (error || !pending) return notFound();
  if (pending.state === "FAILED") {
    return NextResponse.json(
      { state: "FAILED" },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (pending.state !== "CREATED" && pending.state !== "UPLOADED") {
    return uploadProblem(
      409,
      "WF-UPLOAD-STATE",
      `This Pending Upload is ${pending.state}.`,
      "Only an unfinished transfer may be released through this route.",
      "Start a fresh upload only after the current attempt reaches a terminal state.",
    );
  }

  const detail = {
    measured: "The private staging transfer did not complete.",
    rule: "A staged PNG must transfer once under its server-issued key.",
    nextAction: "Choose the file again to start a fresh upload.",
  };
  const failed = await admin.rpc("fail_pending_upload", {
    p_id: id,
    p_code: "WF-UPLOAD-TRANSFER",
    p_detail: detail,
  });
  if (failed.error) {
    return uploadProblem(
      503,
      "WF-UPLOAD-ABANDON",
      "The failed transfer could not be released.",
      "A failed transfer must become terminal before a fresh retry.",
      "Retry releasing this Pending Upload after the service recovers.",
    );
  }
  const removed = await admin.storage
    .from("wrap-staging")
    .remove([pending.staging_key]);
  if (removed.error) {
    const queued = await admin.from("asset_cleanup_jobs").upsert(
      {
        pending_upload_id: id,
        bucket_id: "wrap-staging",
        object_key: pending.staging_key,
        reason: "FAILED_FINALIZATION",
      },
      { onConflict: "bucket_id,object_key", ignoreDuplicates: true },
    );
    if (queued.error) {
      return uploadProblem(
        503,
        "WF-UPLOAD-ABANDON",
        "The failed transfer was recorded but cleanup could not be queued.",
        "A private staging object must be removed or durably queued for cleanup.",
        "Retry releasing this Pending Upload after the service recovers.",
      );
    }
  }
  return NextResponse.json(
    { state: "FAILED", error: { code: "WF-UPLOAD-TRANSFER", ...detail } },
    { headers: { "cache-control": "no-store" } },
  );
}

function notFound() {
  return uploadProblem(
    404,
    "WF-UPLOAD-NOT-FOUND",
    "That Pending Upload is unavailable.",
    "Only its owner may access an existing Pending Upload.",
    "Start a fresh upload from the studio.",
  );
}
