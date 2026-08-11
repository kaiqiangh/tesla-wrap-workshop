import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { observeRoute, type OperationContext } from "@/lib/observability";
import {
  validateWrapMetadata,
  type WrapMetadataInput,
} from "@/lib/wraps/metadata";
import { wrapProblem } from "@/lib/wraps/problem";

export const runtime = "nodejs";

export function POST(request: Request) {
  return observeRoute(request, "WRAP_PUBLISH", "WRAP", (operation) =>
    post(request, operation),
  );
}

async function post(request: Request, operation: OperationContext) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return requestProblem();
  }
  if (!isInput(input)) return requestProblem();

  const metadata = validateWrapMetadata(input);
  if (!metadata.ok) {
    return wrapProblem(
      400,
      metadata.problem.code,
      metadata.problem.measured,
      "Publication metadata must be bounded, canonical, and separately asserted.",
      metadata.problem.nextAction,
    );
  }

  const supabase = await createServerSupabaseClient();
  const access = await readProfileAccess(supabase);
  if (access.status === "guest") {
    return wrapProblem(
      401,
      "WF-WRAP-AUTH",
      "You are signed out.",
      "Publishing requires a completed Active Profile.",
      "Sign in and try again.",
    );
  }
  if (access.status !== "active") {
    return wrapProblem(
      403,
      "WF-WRAP-PARTICIPATION",
      "Your Profile cannot publish right now.",
      "Publishing requires a completed Active Profile.",
      "Complete or restore your Profile before publishing.",
    );
  }
  operation.actorId = access.userId;

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("publish_wrap", {
    p_asset_revision_id: input.assetRevisionId,
    p_creator_id: access.userId,
    p_description: metadata.value.description,
    p_distribution_asserted: metadata.value.distributionAsserted,
    p_license_type: metadata.value.licenseType,
    p_tags: metadata.value.tags,
    p_template_asserted: metadata.value.templateAsserted,
    p_template_variant_id: input.templateVariantId,
    p_title: metadata.value.title,
  });
  if (error) return mapDatabaseError(error.message);
  const published = data?.[0];
  if (!published) return databaseProblem();
  return NextResponse.json(
    {
      created: published.created,
      wrap: {
        id: published.id,
        slug: published.slug,
        status: published.status,
        firstPublishedAt: published.first_published_at,
        assetRevisionId: published.asset_revision_id,
        templateVariantId: published.template_variant_id,
      },
    },
    {
      status: published.created ? 201 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}

function isInput(value: unknown): value is WrapMetadataInput & {
  assetRevisionId: string;
  templateVariantId: string;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) =>
      [
        "assetRevisionId",
        "templateVariantId",
        "title",
        "description",
        "licenseType",
        "tags",
        "templateAsserted",
        "distributionAsserted",
      ].includes(key),
    ) &&
    typeof record.assetRevisionId === "string" &&
    /^[0-9a-f-]{36}$/.test(record.assetRevisionId) &&
    typeof record.templateVariantId === "string" &&
    /^[0-9a-f-]{36}$/.test(record.templateVariantId) &&
    typeof record.title === "string" &&
    typeof record.description === "string" &&
    typeof record.licenseType === "string" &&
    Array.isArray(record.tags) &&
    record.tags.every((tag) => typeof tag === "string") &&
    typeof record.templateAsserted === "boolean" &&
    typeof record.distributionAsserted === "boolean"
  );
}

function requestProblem() {
  return wrapProblem(
    400,
    "WF-WRAP-REQUEST",
    "The publication request is incomplete.",
    "A Wrap needs the READY Asset Revision, exact Template Variant, metadata, license, and two assertions.",
    "Review Add Details and try again.",
  );
}

function mapDatabaseError(message: string) {
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
  if (message === "wrap_not_allowed") {
    return wrapProblem(
      403,
      "WF-WRAP-PARTICIPATION",
      "Your Profile cannot publish right now.",
      "Every publication transition rechecks the completed Active Profile.",
      "Restore your Profile before publishing.",
    );
  }
  if (
    message === "wrap_asset_not_ready" ||
    message === "wrap_assets_incomplete"
  ) {
    return wrapProblem(
      409,
      "WF-WRAP-ASSET",
      "The Asset Revision is not ready to publish.",
      "Publishing requires one owner-scoped Template-verified Asset Revision with all private objects.",
      "Return to Upload File and complete authoritative validation.",
    );
  }
  if (message === "wrap_revision_mismatch") {
    return wrapProblem(
      409,
      "WF-WRAP-REVISION",
      "The selected Template Variant no longer matches this Asset Revision.",
      "A stale form cannot publish a different compatibility claim.",
      "Choose the matching Active Template Variant and review the file again.",
    );
  }
  if (message === "wrap_duplicate_mismatch") {
    return wrapProblem(
      409,
      "WF-WRAP-DUPLICATE",
      "This Pending Asset Revision was already published with different metadata.",
      "A repeated publication must reuse the original Template Variant, metadata, and assertions.",
      "Open the existing Wrap and edit its metadata there.",
    );
  }
  if (message === "wrap_removed_duplicate") {
    return wrapProblem(
      409,
      "WF-WRAP-REMOVED",
      "This Wrap was removed and cannot be published again.",
      "Removal is terminal for the original Asset Revision and slug.",
      "Start a new upload if you want to publish another Wrap.",
    );
  }
  if (message === "wrap_hidden_duplicate") {
    return wrapProblem(
      409,
      "WF-WRAP-HIDDEN",
      "This Wrap is hidden and cannot be published again.",
      "Hidden Wraps remain under moderation control and cannot be reused by a Creator.",
      "Start a new upload or contact an administrator.",
    );
  }
  if (message === "wrap_template_unavailable") {
    return wrapProblem(
      409,
      "WF-WRAP-TEMPLATE",
      "That Template Variant is no longer Active.",
      "New Wraps require an Active database-backed Template Variant.",
      "Choose another Active Template Variant.",
    );
  }
  if (message === "wrap_assertions_required") {
    return wrapProblem(
      400,
      "WF-WRAP-ASSERTIONS",
      "Both publication confirmations are required.",
      "Template use and distribution rights are separate publication gates.",
      "Confirm both statements before publishing.",
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
      "The publication metadata is outside the current limits.",
      "Title, description, license, and canonical Tags are bounded before publication.",
      "Review Add Details and try again.",
    );
  }
  return databaseProblem();
}

function databaseProblem() {
  return wrapProblem(
    503,
    "WF-WRAP-DATABASE",
    "The Wrap could not be recorded.",
    "Publication must commit metadata and public eligibility together.",
    "Retry the same publication after the service recovers.",
  );
}
