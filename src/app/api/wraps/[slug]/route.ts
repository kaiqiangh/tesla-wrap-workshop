import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  validateWrapMetadata,
  type WrapMetadataInput,
} from "@/lib/wraps/metadata";
import { wrapProblem } from "@/lib/wraps/problem";

export const runtime = "nodejs";

type Context = { params: Promise<{ slug: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const slug = await readSlug(params);
  if (!slug) return notFound();
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return requestProblem();
  }
  if (!isEditInput(input)) return requestProblem();
  const metadata = validateWrapMetadata({
    ...input,
    templateAsserted: true,
    distributionAsserted: true,
  });
  if (!metadata.ok) {
    return wrapProblem(
      400,
      metadata.problem.code,
      metadata.problem.measured,
      "Edited metadata remains bounded and canonical.",
      metadata.problem.nextAction,
    );
  }
  const owner = await activeOwner();
  if (owner.response) return owner.response;
  const { data, error } = await createAdminSupabaseClient().rpc("edit_wrap", {
    p_creator_id: owner.userId,
    p_description: metadata.value.description,
    p_license_type: metadata.value.licenseType,
    p_slug: slug,
    p_tags: metadata.value.tags,
    p_title: metadata.value.title,
  });
  if (error) return mapError(error.message);
  const wrap = data?.[0];
  if (!wrap) return databaseProblem();
  return NextResponse.json(
    { wrap },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request, { params }: Context) {
  const slug = await readSlug(params);
  if (!slug) return notFound();
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return requestProblem();
  }
  if (
    !input ||
    typeof input !== "object" ||
    !["unpublish", "republish"].includes(
      (input as { action?: unknown }).action as string,
    )
  ) {
    return requestProblem();
  }
  const owner = await activeOwner();
  if (owner.response) return owner.response;
  const admin = createAdminSupabaseClient();
  const functionName =
    (input as { action: "unpublish" | "republish" }).action === "unpublish"
      ? "unpublish_wrap"
      : "republish_wrap";
  const { data, error } = await admin.rpc(functionName, {
    p_creator_id: owner.userId,
    p_slug: slug,
  });
  if (error) return mapError(error.message);
  const wrap = data?.[0];
  if (!wrap) return databaseProblem();
  return NextResponse.json(
    { wrap },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE(_request: Request, { params }: Context) {
  const slug = await readSlug(params);
  if (!slug) return notFound();
  const owner = await activeOwner();
  if (owner.response) return owner.response;
  const { data, error } = await createAdminSupabaseClient().rpc("remove_wrap", {
    p_creator_id: owner.userId,
    p_slug: slug,
  });
  if (error) return mapError(error.message);
  const wrap = data?.[0];
  if (!wrap) return databaseProblem();
  return NextResponse.json(
    { wrap },
    { headers: { "cache-control": "no-store" } },
  );
}

async function activeOwner() {
  const supabase = await createServerSupabaseClient();
  const access = await readProfileAccess(supabase);
  if (access.status === "guest") {
    return {
      userId: "",
      response: wrapProblem(
        401,
        "WF-WRAP-AUTH",
        "You are signed out.",
        "Wrap management requires a completed Active Profile.",
        "Sign in and try again.",
      ),
    };
  }
  if (access.status !== "active") {
    return {
      userId: "",
      response: wrapProblem(
        403,
        "WF-WRAP-PARTICIPATION",
        "Your Profile cannot manage this Wrap right now.",
        "Every Wrap transition requires a completed Active Profile.",
        "Complete or restore your Profile before trying again.",
      ),
    };
  }
  return { userId: access.userId, response: undefined };
}

async function readSlug(params: Promise<{ slug: string }>) {
  const { slug } = await params;
  return /^[a-z0-9][a-z0-9-]{2,79}$/.test(slug) ? slug : undefined;
}

function isEditInput(
  value: unknown,
): value is Omit<
  WrapMetadataInput,
  "templateAsserted" | "distributionAsserted"
> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) =>
      ["title", "description", "licenseType", "tags"].includes(key),
    ) &&
    typeof record.title === "string" &&
    typeof record.description === "string" &&
    typeof record.licenseType === "string" &&
    Array.isArray(record.tags) &&
    record.tags.every((tag) => typeof tag === "string")
  );
}

function requestProblem() {
  return wrapProblem(
    400,
    "WF-WRAP-REQUEST",
    "The Wrap management request is incomplete.",
    "Use the current Wrap metadata or one supported visibility action.",
    "Review the form and try again.",
  );
}

function notFound() {
  return wrapProblem(
    404,
    "WF-WRAP-NOT-FOUND",
    "That Wrap is unavailable.",
    "Only an owner may manage a known Wrap Slug.",
    "Open the current Wrap link and try again.",
  );
}

function mapError(message: string) {
  if (message === "publish_rate_limited") {
    return wrapProblem(
      429,
      "WF-WRAP-RATE",
      "Publication activity is temporarily limited.",
      "A User may publish or unpublish at most ten times per rolling hour.",
      "Wait before changing Wrap visibility again.",
      { "retry-after": "3600" },
    );
  }
  if (message === "wrap_not_found") return notFound();
  if (message === "wrap_not_allowed") {
    return wrapProblem(
      403,
      "WF-WRAP-PARTICIPATION",
      "Your Profile cannot manage this Wrap right now.",
      "Every Wrap transition rechecks Active participation.",
      "Restore your Profile before trying again.",
    );
  }
  if (message === "wrap_unavailable") {
    return wrapProblem(
      409,
      "WF-WRAP-STATE",
      "This Wrap is already withdrawn from normal management.",
      "Hidden and Removed Wraps cannot be edited or republished by a Creator.",
      "Return to your Profile or contact an administrator.",
    );
  }
  if (message === "wrap_asset_not_ready") {
    return wrapProblem(
      409,
      "WF-WRAP-ASSET",
      "The Asset Revision is no longer complete.",
      "A Published Wrap must retain all immutable private assets.",
      "Retry after the asset is reconciled.",
    );
  }
  if (
    message === "wrap_metadata_invalid" ||
    message === "invalid_tag" ||
    message === "too_many_tags"
  ) {
    return wrapProblem(
      400,
      "WF-WRAP-METADATA",
      "The Wrap metadata is outside the current limits.",
      "Edited title, description, license, and Tags remain bounded.",
      "Review the fields and try again.",
    );
  }
  return databaseProblem();
}

function databaseProblem() {
  return wrapProblem(
    503,
    "WF-WRAP-DATABASE",
    "The Wrap transition could not be recorded.",
    "Management changes must commit one authoritative state.",
    "Retry after the service recovers.",
  );
}
