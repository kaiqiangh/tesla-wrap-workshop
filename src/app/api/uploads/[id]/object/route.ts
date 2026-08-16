import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requestContentLengthExceedsLimit } from "@/lib/request-size";
import { uploadProblem } from "@/lib/upload/problem";

export const runtime = "nodejs";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return observeRoute(request, "UPLOAD_TRANSFER", "UPLOAD", (operation) =>
    post(request, context, operation),
  );
}

async function post(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  operation: OperationContext,
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return notFound();

  const supabase = await createServerSupabaseClient();
  const access = await readProfileAccess(supabase);
  if (access.status !== "guest") operation.actorId = access.userId;
  if (access.status !== "active") {
    return uploadProblem(
      access.status === "guest" ? 401 : 403,
      "WF-UPLOAD-PARTICIPATION",
      "This upload cannot receive a file.",
      "A private transfer requires a completed Active Profile.",
      "Restore your Profile or sign in again.",
    );
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("get_pending_upload_for_owner", {
    p_id: id,
    p_owner: access.userId,
  });
  const pending = data?.[0];
  if (error) {
    return uploadProblem(
      503,
      "WF-UPLOAD-DATABASE",
      "The Pending Upload could not be read.",
      "A private transfer requires a healthy upload database boundary.",
      "Retry this transfer after the upload service recovers.",
    );
  }
  if (!pending) return notFound();
  if (pending.state !== "CREATED" && pending.state !== "UPLOADED") {
    return uploadProblem(
      409,
      "WF-UPLOAD-STATE",
      "This upload is no longer accepting a file.",
      "Only an unfinished Pending Upload may receive its private object.",
      "Retry finalization or start a fresh upload after this attempt settles.",
    );
  }

  const expiresAt = Date.parse(pending.expires_at);
  if (!Number.isFinite(expiresAt)) {
    return uploadProblem(
      503,
      "WF-UPLOAD-DATABASE",
      "This upload expiry is temporarily unavailable.",
      "The Pending Upload must have a valid server-side expiry.",
      "Retry this transfer after the upload service recovers.",
    );
  }
  if (expiresAt <= Date.now()) {
    const claimed = await admin.rpc("claim_pending_upload", {
      p_id: id,
      p_owner: pending.owner_id,
    });
    if (claimed.error) return databaseFailure();
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
        "WF-UPLOAD-CLEANUP",
        "The expired transfer could not be queued for cleanup.",
        "Expired private staging objects must be durably queued before release.",
        "Retry this transfer after the cleanup service recovers.",
      );
    }
    return uploadProblem(
      410,
      "WF-UPLOAD-EXPIRED",
      "This Pending Upload has expired.",
      "Expired private staging transfers cannot receive more bytes.",
      "Start a fresh upload from the studio.",
    );
  }

  const maxFileBytes = Number(pending.max_file_bytes);
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    return uploadProblem(
      503,
      "WF-UPLOAD-DATABASE",
      "This upload limit is temporarily unavailable.",
      "The Pending Upload must have a valid server-side size limit.",
      "Retry this transfer after the upload service recovers.",
    );
  }
  if (
    requestContentLengthExceedsLimit(
      request.headers.get("content-length"),
      maxFileBytes,
    )
  ) {
    return uploadProblem(
      413,
      "WF-UPLOAD-SIZE",
      "The PNG is outside the allowed size range.",
      "The private transfer must match the selected Template Variant limit.",
      "Choose a smaller PNG and start a fresh upload.",
    );
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return invalidRequest();
  }
  if (!(file instanceof File) || file.type !== "image/png") {
    return invalidRequest();
  }
  if (file.size <= 0 || file.size > maxFileBytes) {
    return uploadProblem(
      422,
      "WF-UPLOAD-SIZE",
      "The PNG is outside the allowed size range.",
      "The private transfer must match the selected Template Variant limit.",
      "Choose a smaller PNG and start a fresh upload.",
    );
  }

  let uploaded: { error: unknown };
  try {
    uploaded = await admin.storage
      .from("wrap-staging")
      .upload(pending.staging_key, new Uint8Array(await file.arrayBuffer()), {
        contentType: "image/png",
        upsert: false,
      });
  } catch {
    if (!(await queueStagingCleanup(admin, pending))) {
      return uploadProblem(
        503,
        "WF-UPLOAD-CLEANUP",
        "The private transfer failed and cleanup could not be queued.",
        "A transfer with an uncertain Storage outcome must be durably queued.",
        "Retry after the cleanup service recovers.",
      );
    }
    return transferFailure();
  }
  if (uploaded.error) {
    try {
      const existing = await admin.storage
        .from("wrap-staging")
        .info(pending.staging_key);
      if (!existing.error && existing.data) {
        return NextResponse.json(
          { state: "UPLOADED" },
          { headers: { "cache-control": "no-store" } },
        );
      }
    } catch {
      // The durable cleanup queue below remains the safe fallback.
    }
    if (!(await queueStagingCleanup(admin, pending))) {
      return uploadProblem(
        503,
        "WF-UPLOAD-CLEANUP",
        "The private transfer failed and cleanup could not be queued.",
        "A transfer with an uncertain Storage outcome must be durably queued.",
        "Retry after the cleanup service recovers.",
      );
    }
    return transferFailure();
  }

  return NextResponse.json(
    { state: "UPLOADED" },
    { headers: { "cache-control": "no-store" } },
  );
}

async function queueStagingCleanup(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  pending: { id: string; staging_key: string },
) {
  const { error } = await admin.from("asset_cleanup_jobs").upsert(
    {
      pending_upload_id: pending.id,
      bucket_id: "wrap-staging",
      object_key: pending.staging_key,
      reason: "FAILED_FINALIZATION",
    },
    { onConflict: "bucket_id,object_key", ignoreDuplicates: true },
  );
  return !error;
}

function transferFailure() {
  return uploadProblem(
    503,
    "WF-UPLOAD-TRANSFER",
    "The private transfer did not complete.",
    "The PNG must upload once under its server-issued owner key.",
    "Retry this same transfer or release the Pending Upload before starting over.",
  );
}

function databaseFailure() {
  return uploadProblem(
    503,
    "WF-UPLOAD-DATABASE",
    "The Pending Upload could not be updated safely.",
    "Expired transfers must be transitioned and queued through the database boundary.",
    "Retry this transfer after the upload service recovers.",
  );
}

function invalidRequest() {
  return uploadProblem(
    400,
    "WF-UPLOAD-REQUEST",
    "The private PNG transfer is incomplete.",
    "Send one PNG file in the multipart `file` field.",
    "Choose the file again and retry the transfer.",
  );
}

function notFound() {
  return uploadProblem(
    404,
    "WF-UPLOAD-NOT-FOUND",
    "That Pending Upload is unavailable.",
    "Only its Active owner may access an existing Pending Upload.",
    "Start a fresh upload from the studio.",
  );
}
