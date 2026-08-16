import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { uploadProblem } from "@/lib/upload/problem";

export const runtime = "nodejs";

export function POST(request: Request) {
  return observeRoute(request, "UPLOAD_START", "UPLOAD", (operation) =>
    post(request, operation),
  );
}

async function post(request: Request, operation: OperationContext) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return invalidRequest();
  }
  if (!isInput(input)) return invalidRequest();

  const supabase = await createServerSupabaseClient();
  const access = await readProfileAccess(supabase);
  if (access.status === "guest") {
    return uploadProblem(
      401,
      "WF-UPLOAD-AUTH",
      "You are signed out.",
      "Starting an upload requires a completed Active Profile.",
      "Sign in and try again.",
    );
  }
  if (access.status !== "active") {
    return uploadProblem(
      403,
      "WF-UPLOAD-PARTICIPATION",
      "Your Profile cannot upload right now.",
      "Starting an upload requires a completed Active Profile.",
      "Complete or restore your Profile before trying again.",
    );
  }
  operation.actorId = access.userId;

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("start_pending_upload_for_owner", {
    p_owner: access.userId,
    p_template_variant_id: input.templateVariantId,
    p_original_filename: input.filename,
    p_declared_mime_type: input.mimeType,
    p_template_asserted: input.templateAsserted,
  });
  if (error?.message === "too_many_active_uploads") {
    return uploadProblem(
      429,
      "WF-UPLOAD-ACTIVE-LIMIT",
      "You already have two active uploads.",
      "At most two Pending Uploads may be active.",
      "Finish or wait for an existing upload to expire, then try again.",
      { "retry-after": "60" },
    );
  }
  if (error?.message === "upload_rate_limited") {
    return uploadProblem(
      429,
      "WF-UPLOAD-RATE",
      "Upload activity is temporarily limited.",
      "At most ten Pending Uploads may start per User per rolling hour.",
      "Wait before starting another upload.",
      { "retry-after": "3600" },
    );
  }
  if (error?.message === "upload_not_allowed") {
    return uploadProblem(
      403,
      "WF-UPLOAD-PARTICIPATION",
      "Your Profile can no longer start this upload.",
      "Every Pending Upload transition requires a completed Active Profile.",
      "Restore your Profile before starting a fresh upload.",
    );
  }
  if (error?.message === "template_unavailable") {
    return uploadProblem(
      409,
      "WF-UPLOAD-TEMPLATE",
      "That Template Variant is no longer Active.",
      "New uploads require an Active database-backed Template Variant.",
      "Choose another Active Template Variant.",
    );
  }
  if (error?.message === "launch_policy_missing") {
    return uploadProblem(
      503,
      "WF-UPLOAD-DATABASE",
      "Upload protection is temporarily unavailable.",
      "The upload limit policy is unavailable, so no Pending Upload was created.",
      "Retry after the service recovers.",
    );
  }
  const upload = data?.[0];
  if (error || !upload) {
    return uploadProblem(
      503,
      "WF-UPLOAD-DATABASE",
      "The upload could not be started safely.",
      "A Pending Upload is created only when the private upload boundary is healthy.",
      "Retry starting the upload after the service recovers.",
    );
  }

  return NextResponse.json(
    { id: upload.id, expires_at: upload.expires_at },
    {
      status: 201,
      headers: { "cache-control": "no-store" },
    },
  );
}

function isInput(value: unknown): value is {
  templateVariantId: string;
  filename: string;
  mimeType: string;
  templateAsserted: boolean;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) =>
      [
        "templateVariantId",
        "filename",
        "mimeType",
        "templateAsserted",
      ].includes(key),
    ) &&
    typeof record.templateVariantId === "string" &&
    /^[0-9a-f-]{36}$/.test(record.templateVariantId) &&
    typeof record.filename === "string" &&
    record.filename.length <= 255 &&
    typeof record.mimeType === "string" &&
    typeof record.templateAsserted === "boolean"
  );
}

function invalidRequest() {
  return uploadProblem(
    400,
    "WF-UPLOAD-REQUEST",
    "The upload request is incomplete.",
    "Choose an Active Template Variant, a PNG, and confirm the template assertion.",
    "Review the first two steps and try again.",
  );
}
