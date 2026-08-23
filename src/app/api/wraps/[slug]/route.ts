import { NextResponse } from "next/server";

import { requireActiveProfile } from "@/lib/auth/profile-access";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { observeRoute, type OperationContext } from "@/lib/observability";
import {
  validateWrapMetadata,
  type WrapMetadataInput,
} from "@/lib/wraps/metadata";
import { wrapProblem } from "@/lib/wraps/problem";

export const runtime = "nodejs";

type Context = { params: Promise<{ slug: string }> };

export function PATCH(request: Request, context: Context) {
  return observeRoute(request, "WRAP_EDIT", "WRAP", (operation) =>
    patch(request, context, operation),
  );
}

async function patch(
  request: Request,
  { params }: Context,
  operation: OperationContext,
) {
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
  const owner = await activeOwner(operation);
  if (owner.response) return owner.response;
  operation.actorId = owner.userId;
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

export function POST(request: Request, context: Context) {
  return observeRoute(request, "WRAP_TRANSITION", "WRAP", (operation) =>
    post(request, context, operation),
  );
}

async function post(
  request: Request,
  { params }: Context,
  operation: OperationContext,
) {
  const slug = await readSlug(params);
  if (!slug) return notFound();
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return requestProblem();
  }
  if (!input || typeof input !== "object") {
    return requestProblem();
  }
  const record = input as Record<string, unknown>;
  const action = record.action;
  const assetRevisionId = record.assetRevisionId;
  const templateVariantId = record.templateVariantId;
  if (
    action !== "unpublish" &&
    action !== "republish" &&
    action !== "replace"
  ) {
    return requestProblem();
  }
  if (
    action === "replace" &&
    (!isUuid(assetRevisionId) || !isUuid(templateVariantId))
  ) {
    return requestProblem();
  }
  const owner = await activeOwner(operation);
  if (owner.response) return owner.response;
  operation.actorId = owner.userId;
  const admin = createAdminSupabaseClient();
  const { data, error } =
    action === "replace"
      ? await admin.rpc("replace_wrap_asset", {
          p_asset_revision_id: assetRevisionId as string,
          p_creator_id: owner.userId,
          p_slug: slug,
          p_template_variant_id: templateVariantId as string,
        })
      : await admin.rpc(
          action === "unpublish" ? "unpublish_wrap" : "republish_wrap",
          {
            p_creator_id: owner.userId,
            p_slug: slug,
          },
        );
  if (error) return mapError(error.message);
  const wrap = data?.[0];
  if (!wrap) return databaseProblem();
  return NextResponse.json(
    { wrap },
    { headers: { "cache-control": "no-store" } },
  );
}

export function DELETE(request: Request, context: Context) {
  return observeRoute(request, "WRAP_REMOVE", "WRAP", (operation) =>
    remove(context, operation),
  );
}

async function remove({ params }: Context, operation: OperationContext) {
  const slug = await readSlug(params);
  if (!slug) return notFound();
  const owner = await activeOwner(operation);
  if (owner.response) return owner.response;
  operation.actorId = owner.userId;
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

async function activeOwner(operation: OperationContext) {
  const gate = await requireActiveProfile(
    await createServerSupabaseClient(),
    operation,
    wrapProblem,
    {
      auth: "WF-WRAP-AUTH",
      participation: "WF-WRAP-PARTICIPATION",
      db: "WF-WRAP-DATABASE",
    },
  );
  return gate.ok ? { userId: gate.userId, response: undefined } : { response: gate.response };
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
  if (message === "wrap_assets_incomplete") {
    return wrapProblem(
      409,
      "WF-WRAP-ASSET",
      "The replacement Asset Revision is incomplete.",
      "Every replacement must retain its verified Original and Derived objects.",
      "Retry after the asset is reconciled.",
    );
  }
  if (message === "wrap_revision_in_use") {
    return wrapProblem(
      409,
      "WF-WRAP-REVISION",
      "That Asset Revision is already attached to a Wrap.",
      "An immutable Asset Revision can belong to only one public Wrap.",
      "Choose a fresh completed upload.",
    );
  }
  if (message === "wrap_revision_cleanup_pending") {
    return wrapProblem(
      409,
      "WF-WRAP-ASSET",
      "That Asset Revision is still awaiting cleanup.",
      "A revision scheduled for removal cannot be published again.",
      "Choose a fresh completed upload.",
    );
  }
  if (message === "wrap_template_unavailable") {
    return wrapProblem(
      409,
      "WF-WRAP-TEMPLATE",
      "The selected Template Variant is no longer available.",
      "A replacement must use an Active verified Template Variant.",
      "Choose the current catalog variant and retry.",
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

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
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
