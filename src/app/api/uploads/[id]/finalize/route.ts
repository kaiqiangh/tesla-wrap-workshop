import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { requireActiveProfile } from "@/lib/auth/profile-access";
import type { Database, Json } from "@/lib/database.types";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { finalizePng, UploadValidationError } from "@/lib/upload/image";
import { persistAssetRevision, type AssetObject } from "@/lib/upload/persist";
import { uploadProblem } from "@/lib/upload/problem";

export const runtime = "nodejs";
export const maxDuration = 15;

type Pending =
  Database["public"]["Functions"]["get_pending_upload_for_owner"]["Returns"][number];
type PendingRead = { pending: Pending | null; error: boolean };

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return observeRoute(request, "UPLOAD_FINALIZE", "UPLOAD", (operation) =>
    post(context, operation),
  );
}

async function post(
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
  operation.actorId = gate.userId;
  const admin = createAdminSupabaseClient();

  let pendingRead = await readPending(admin, gate.userId, id);
  if (pendingRead.error) return uncertainDatabaseResponse();
  let pending = pendingRead.pending;
  if (!pending) return notFound();
  if (pending.state === "EXPIRED") {
    if (
      !(await queueCleanup(
        admin,
        id,
        [stagingAsset(pending.staging_key)],
        "FAILED_FINALIZATION",
      ))
    ) {
      return uncertainDatabaseResponse();
    }
    return settledResponse(pending) ?? notFound();
  }
  const settled = settledResponse(pending);
  if (settled) return settled;
  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    const expired = await admin.rpc("claim_pending_upload", {
      p_id: id,
      p_owner: pending.owner_id,
    });
    if (expired.error) return uncertainDatabaseResponse();
    if (
      !(await queueCleanup(
        admin,
        id,
        [stagingAsset(pending.staging_key)],
        "FAILED_FINALIZATION",
      ))
    ) {
      return uncertainDatabaseResponse();
    }
    pendingRead = await readPending(admin, gate.userId, id);
    if (pendingRead.error) return uncertainDatabaseResponse();
    pending = pendingRead.pending;
    return (pending && settledResponse(pending)) ?? notFound();
  }

  const stagedInfo = await admin.storage
    .from("wrap-staging")
    .info(pending.staging_key);
  if (stagedInfo.error || !stagedInfo.data) {
    return uploadProblem(
      409,
      "WF-UPLOAD-STAGING",
      "The staged PNG is not available yet.",
      "Finalization requires the issued private staging object.",
      "Upload the preflight-approved PNG, then retry finalization.",
    );
  }

  const { data: claimData, error: claimError } = await admin.rpc(
    "claim_pending_upload",
    { p_id: id, p_owner: pending.owner_id },
  );
  const claim = claimData?.[0];
  if (claimError?.message === "upload_not_allowed") {
    return uploadProblem(
      403,
      "WF-UPLOAD-PARTICIPATION",
      "This upload can no longer be finalized.",
      "Finalization requires a completed Active Profile at every database transition.",
      "Restore your Profile before retrying this upload.",
    );
  }
  if (claimError?.message === "upload_rate_limited") {
    return uploadProblem(
      429,
      "WF-UPLOAD-RATE",
      "Finalization activity is temporarily limited.",
      "At most ten new Pending Upload finalizations may start per User per rolling hour.",
      "Wait before finalizing another Pending Upload.",
      { "retry-after": "3600" },
    );
  }
  if (claimError) return uncertainDatabaseResponse();
  if (!claim) return notFound();
  if (!claim.claimed) {
    pendingRead =
      claim.state === "VALIDATING"
        ? await waitForResult(admin, gate.userId, id)
        : await readPending(admin, gate.userId, id);
    if (pendingRead.error) return uncertainDatabaseResponse();
    pending = pendingRead.pending;
    const response = pending && settledResponse(pending);
    if (response) return response;
    if (claim.state === "VALIDATING") {
      return uploadProblem(
        503,
        "WF-UPLOAD-BUSY",
        "Authoritative validation is still running.",
        "Only one finalization may create the immutable Asset Revision.",
        "Retry this same finalization request.",
      );
    }
    return notFound();
  }

  const staged = await admin.storage
    .from("wrap-staging")
    .download(pending.staging_key);
  if (staged.error || !staged.data) {
    const detail = persistenceFailure("WF-UPLOAD-STORAGE");
    if (!(await fail(admin, id, "WF-UPLOAD-STORAGE", detail))) {
      return uncertainDatabaseResponse();
    }
    if (
      !(await removeOrQueue(
        admin,
        id,
        [stagingAsset(pending.staging_key)],
        "FAILED_FINALIZATION",
      ))
    ) {
      return uploadProblem(
        503,
        "WF-UPLOAD-CLEANUP",
        "Temporary asset cleanup could not be recorded.",
        "Partial cross-system work must be removed or queued for reconciliation.",
        "Retry after the service recovers; do not reuse this attempt.",
      );
    }
    return uploadProblem(
      503,
      "WF-UPLOAD-STORAGE",
      detail.measured,
      detail.rule,
      detail.nextAction,
    );
  }

  let rendered: Awaited<ReturnType<typeof finalizePng>>;
  try {
    rendered = await finalizePng(
      new Uint8Array(await staged.data.arrayBuffer()),
      {
        filename: pending.original_filename,
        mimeType: staged.data.type,
        asserted: pending.template_asserted,
        width: pending.width_px,
        height: pending.height_px,
        maxBytes: pending.max_file_bytes,
      },
    );
  } catch (error) {
    if (error instanceof UploadValidationError) {
      const recorded = await fail(admin, id, error.code, {
        measured: error.measured,
        rule: error.rule,
        nextAction: error.nextAction,
      });
      if (!recorded) return uncertainDatabaseResponse();
      if (
        !(await removeOrQueue(
          admin,
          id,
          [stagingAsset(pending.staging_key)],
          "FAILED_FINALIZATION",
        ))
      ) {
        return uploadProblem(
          503,
          "WF-UPLOAD-CLEANUP",
          "Temporary asset cleanup could not be recorded.",
          "Partial cross-system work must be removed or queued for reconciliation.",
          "Retry after the service recovers; do not reuse this attempt.",
        );
      }
      return uploadProblem(
        422,
        error.code,
        error.measured,
        error.rule,
        error.nextAction,
      );
    }
    const detail = {
      measured: "The PNG pixels could not be read safely.",
      rule: "The complete PNG must decode within the current pixel limit.",
      nextAction: "Export a fresh PNG and start a new upload.",
    };
    if (!(await fail(admin, id, "WF-UPLOAD-DECODE", detail))) {
      return uncertainDatabaseResponse();
    }
    if (
      !(await removeOrQueue(
        admin,
        id,
        [stagingAsset(pending.staging_key)],
        "FAILED_FINALIZATION",
      ))
    ) {
      return uploadProblem(
        503,
        "WF-UPLOAD-CLEANUP",
        "Temporary asset cleanup could not be recorded.",
        "Partial cross-system work must be removed or queued for reconciliation.",
        "Retry after the service recovers; do not reuse this attempt.",
      );
    }
    return uploadProblem(
      422,
      "WF-UPLOAD-DECODE",
      detail.measured,
      detail.rule,
      detail.nextAction,
    );
  }

  // The Pending Upload is the idempotency boundary: every retry reuses its
  // revision id, so an uncertain completion cannot create a second revision.
  const revisionId = id;
  const prefix = `${pending.owner_id}/${revisionId}`;
  const assets: AssetObject[] = [
    {
      bucket: "wrap-originals",
      key: `${prefix}/original.png`,
      bytes: rendered.original.bytes,
    },
    {
      bucket: "wrap-derived",
      key: `${prefix}/preview.png`,
      bytes: rendered.preview.bytes,
    },
    {
      bucket: "wrap-derived",
      key: `${prefix}/thumbnail.png`,
      bytes: rendered.thumbnail.bytes,
    },
  ];
  const persisted = await persistAssetRevision({
    assets,
    store: (asset) => store(admin, asset),
    complete: async () => {
      const { data, error } = await admin.rpc("complete_pending_upload", {
        p_id: id,
        p_revision_id: revisionId,
        p_width: rendered.original.width,
        p_height: rendered.original.height,
        p_original_bytes: rendered.original.bytes.byteLength,
        p_original_sha256: rendered.original.sha256,
        p_preview_width: rendered.preview.width,
        p_preview_height: rendered.preview.height,
        p_preview_bytes: rendered.preview.bytes.byteLength,
        p_preview_sha256: rendered.preview.sha256,
        p_thumbnail_width: rendered.thumbnail.width,
        p_thumbnail_height: rendered.thumbnail.height,
        p_thumbnail_bytes: rendered.thumbnail.bytes.byteLength,
        p_thumbnail_sha256: rendered.thumbnail.sha256,
      });
      if (!error && data === revisionId) return "complete";
      const verification = await admin
        .from("pending_uploads")
        .select("state, asset_revision_id, failure_code")
        .eq("id", id)
        .maybeSingle();
      if (verification.error || !verification.data) return "unknown";
      if (
        verification.data.state === "READY" &&
        verification.data.asset_revision_id === revisionId
      ) {
        return "complete";
      }
      return verification.data.state === "FAILED" ? "failed" : "unknown";
    },
    remove: (stored) => removeOrQueue(admin, id, stored, "FAILED_FINALIZATION"),
    fail: (code) => fail(admin, id, code, persistenceFailure(code)),
    removeStaging: async () => {
      const { error } = await admin.storage
        .from("wrap-staging")
        .remove([pending.staging_key]);
      if (!error) return true;
      return queueCleanup(
        admin,
        id,
        [stagingAsset(pending.staging_key)],
        "STAGING_AFTER_READY",
      );
    },
  });
  if (persisted === "WF-UPLOAD-STORAGE") {
    return uploadProblem(
      503,
      persisted,
      persistenceFailure(persisted).measured,
      persistenceFailure(persisted).rule,
      persistenceFailure(persisted).nextAction,
    );
  }
  if (persisted === "WF-UPLOAD-DATABASE") {
    return uploadProblem(
      503,
      persisted,
      persistenceFailure(persisted).measured,
      persistenceFailure(persisted).rule,
      persistenceFailure(persisted).nextAction,
    );
  }
  if (persisted === "WF-UPLOAD-CLEANUP") {
    return uploadProblem(
      503,
      persisted,
      persistenceFailure(persisted).measured,
      persistenceFailure(persisted).rule,
      persistenceFailure(persisted).nextAction,
    );
  }
  if (persisted === "WF-UPLOAD-DATABASE-UNKNOWN") {
    return uncertainDatabaseResponse();
  }
  return ready(revisionId, rendered.original);
}

async function readPending(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  ownerId: string,
  id: string,
): Promise<PendingRead> {
  const { data, error } = await admin.rpc("get_pending_upload_for_owner", {
    p_id: id,
    p_owner: ownerId,
  });
  if (error) return { pending: null, error: true };
  return { pending: data?.[0] ?? null, error: false };
}

async function waitForResult(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  ownerId: string,
  id: string,
): Promise<PendingRead> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pending = await readPending(admin, ownerId, id);
    if (
      pending.error ||
      !pending.pending ||
      pending.pending.state !== "VALIDATING"
    ) {
      return pending;
    }
  }
  return { pending: null, error: false };
}

function settledResponse(pending: NonNullable<Pending>) {
  if (pending.state === "READY" && pending.asset_revision_id) {
    return ready(pending.asset_revision_id);
  }
  if (pending.state === "EXPIRED") {
    return uploadProblem(
      410,
      "WF-UPLOAD-EXPIRED",
      "This Pending Upload expired after 24 hours.",
      "Expired staging attempts cannot become assets.",
      "Start a fresh upload.",
    );
  }
  if (pending.state === "FAILED" && pending.failure_code) {
    const detail = isFailureDetail(pending.failure_detail)
      ? pending.failure_detail
      : genericFailure("Finalization failed");
    return uploadProblem(
      pending.failure_code === "WF-UPLOAD-STORAGE" ||
        pending.failure_code === "WF-UPLOAD-DATABASE" ||
        pending.failure_code === "WF-UPLOAD-CLEANUP" ||
        pending.failure_code === "WF-UPLOAD-DATABASE-UNKNOWN"
        ? 503
        : 422,
      pending.failure_code,
      detail.measured,
      detail.rule,
      detail.nextAction,
    );
  }
  return null;
}

function ready(
  revisionId: string,
  original?: { width: number; height: number; bytes: Buffer; sha256: string },
) {
  return NextResponse.json(
    {
      state: "READY",
      assetRevisionId: revisionId,
      ...(original && {
        width: original.width,
        height: original.height,
        byteSize: original.bytes.byteLength,
        sha256: original.sha256,
      }),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}

async function store(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  asset: AssetObject,
) {
  if (asset.bucket === "wrap-staging") {
    throw new Error("staging_is_not_an_asset");
  }
  const { error } = await admin.storage
    .from(asset.bucket)
    .upload(asset.key, asset.bytes, {
      contentType: "image/png",
      upsert: false,
    });
  if (!error) return;
  const existing = await admin.storage.from(asset.bucket).download(asset.key);
  if (!existing.error && existing.data) {
    const bytes = Buffer.from(await existing.data.arrayBuffer());
    if (
      bytes.byteLength === asset.bytes.byteLength &&
      createHash("sha256").update(bytes).digest("hex") ===
        createHash("sha256").update(asset.bytes).digest("hex")
    ) {
      return;
    }
  }
  throw new Error("asset_storage_failed");
}

function stagingAsset(key: string): AssetObject {
  return { bucket: "wrap-staging", key, bytes: Buffer.alloc(0) };
}

async function removeOrQueue(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  pendingId: string,
  uploaded: AssetObject[],
  reason: "FAILED_FINALIZATION" | "STAGING_AFTER_READY",
) {
  const stranded: AssetObject[] = [];
  for (const bucket of [
    "wrap-staging",
    "wrap-originals",
    "wrap-derived",
  ] as const) {
    const assets = uploaded.filter((item) => item.bucket === bucket);
    if (!assets.length) continue;
    const result = await admin.storage
      .from(bucket)
      .remove(assets.map((item) => item.key));
    if (result.error) stranded.push(...assets);
  }
  return (
    stranded.length === 0 ||
    (await queueCleanup(admin, pendingId, stranded, reason))
  );
}

async function queueCleanup(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  pendingId: string,
  assets: AssetObject[],
  reason: "FAILED_FINALIZATION" | "STAGING_AFTER_READY",
) {
  if (!assets.length) return true;
  const { error } = await admin.from("asset_cleanup_jobs").upsert(
    assets.map((asset) => ({
      pending_upload_id: pendingId,
      bucket_id: asset.bucket,
      object_key: asset.key,
      reason,
    })),
    { onConflict: "bucket_id,object_key", ignoreDuplicates: true },
  );
  return !error;
}

async function fail(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  id: string,
  code: string,
  detail: Json,
) {
  const { error } = await admin.rpc("fail_pending_upload", {
    p_id: id,
    p_code: code,
    p_detail: detail,
  });
  return !error;
}

function genericFailure(measured: string) {
  return {
    measured,
    rule: "Finalization must complete without a decode, Storage, or database failure.",
    nextAction: "Start a fresh upload after the service recovers.",
  };
}

function persistenceFailure(
  code: "WF-UPLOAD-STORAGE" | "WF-UPLOAD-DATABASE" | "WF-UPLOAD-CLEANUP",
) {
  if (code === "WF-UPLOAD-CLEANUP") {
    return {
      measured: "Temporary asset cleanup could not be recorded.",
      rule: "Partial cross-system work must be removed or queued for reconciliation.",
      nextAction:
        "Retry after the service recovers; do not reuse this attempt.",
    };
  }
  return code === "WF-UPLOAD-STORAGE"
    ? {
        measured: "The validated assets could not be stored.",
        rule: "READY requires the Original, preview, and thumbnail to all exist privately.",
        nextAction: "Start a fresh upload after the service recovers.",
      }
    : {
        measured: "The immutable Asset Revision could not be recorded.",
        rule: "READY requires one database record referencing all required private assets.",
        nextAction: "Start a fresh upload after the service recovers.",
      };
}

function uncertainDatabaseResponse() {
  return uploadProblem(
    503,
    "WF-UPLOAD-DATABASE-UNKNOWN",
    "The final database outcome could not be confirmed.",
    "Asset objects remain private until READY or FAILED is read back durably.",
    "Retry this same finalization request after the service recovers.",
  );
}

function isFailureDetail(
  value: Json | null,
): value is { measured: string; rule: string; nextAction: string } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.measured === "string" &&
    typeof value.rule === "string" &&
    typeof value.nextAction === "string"
  );
}

function notFound() {
  return uploadProblem(
    404,
    "WF-UPLOAD-NOT-FOUND",
    "That Pending Upload is unavailable.",
    "Only its owner may finalize an existing Pending Upload.",
    "Start a fresh upload from the studio.",
  );
}
