import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import {
  exceedsAvatarRequestLimit,
  normalizeAvatar,
  MAX_AVATAR_BYTES,
} from "@/lib/profile/avatar";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  let access;
  try {
    access = await readProfileAccess(supabase);
  } catch {
    return problem(
      503,
      "profile_unavailable",
      "Profile is temporarily unavailable.",
    );
  }
  if (access.status === "guest")
    return problem(401, "authentication_required", "Sign in to continue.");
  if (access.status !== "active")
    return problem(
      403,
      "profile_unavailable",
      "Your Profile cannot be edited right now.",
    );
  if (exceedsAvatarRequestLimit(request.headers.get("content-length")))
    return problem(
      400,
      "avatar_size",
      "Avatar files must be no larger than 2 MiB.",
    );

  let file: File | null;
  try {
    file = (await request.formData()).get("avatar") as File | null;
  } catch {
    return problem(
      400,
      "avatar_request",
      "Choose a PNG, JPEG, or WebP avatar.",
    );
  }
  if (!file || typeof file.arrayBuffer !== "function")
    return problem(
      400,
      "avatar_request",
      "Choose a PNG, JPEG, or WebP avatar.",
    );
  if (file.size > MAX_AVATAR_BYTES)
    return problem(
      400,
      "avatar_size",
      "Avatar files must be no larger than 2 MiB.",
    );

  let normalized;
  try {
    normalized = await normalizeAvatar(
      Buffer.from(await file.arrayBuffer()),
      file.type,
    );
  } catch (error) {
    const candidate = error instanceof Error ? error.message : "";
    const code = [
      "avatar_mime",
      "avatar_size",
      "avatar_decode",
      "avatar_format",
    ].includes(candidate)
      ? candidate
      : "avatar_decode";
    const messages: Record<string, string> = {
      avatar_mime: "Use a PNG, JPEG, or WebP avatar.",
      avatar_size: "Avatar files must be no larger than 2 MiB.",
      avatar_decode: "That avatar could not be decoded safely.",
      avatar_format: "Use a PNG, JPEG, or WebP avatar.",
    };
    return problem(400, code, messages[code] ?? messages.avatar_decode);
  }

  const admin = createAdminSupabaseClient();
  const base = `${access.userId}/${randomUUID()}`;
  const sourceKey = `${base}/source`;
  const derivedKey = `${base}/avatar.png`;
  const uploaded: Array<{ bucket: string; key: string }> = [];
  let rpcAttempted = false;
  try {
    const source = await admin.storage
      .from("profile-source")
      .upload(sourceKey, normalized.source, {
        contentType: file.type,
        upsert: false,
      });
    if (source.error) throw source.error;
    uploaded.push({ bucket: "profile-source", key: sourceKey });
    const derived = await admin.storage
      .from("profile-derived")
      .upload(derivedKey, normalized.derived, {
        contentType: "image/png",
        upsert: false,
      });
    if (derived.error) throw derived.error;
    uploaded.push({ bucket: "profile-derived", key: derivedKey });

    rpcAttempted = true;
    const { data, error } = await admin.rpc("replace_profile_avatar", {
      p_profile_id: access.userId,
      p_source_key: sourceKey,
      p_derived_key: derivedKey,
      p_width_px: normalized.width,
      p_height_px: normalized.height,
      p_byte_size: normalized.derived.byteLength,
      p_sha256: normalized.sha256,
    });
    if (error || !data?.[0]?.avatar_url)
      throw error ?? new Error("avatar_not_saved");
    return NextResponse.json(data[0], {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    let cleanupQueueFailed = false;
    let outcomeUnknown = false;
    if (!rpcAttempted) {
      const removals = await Promise.all(
        uploaded.map(async ({ bucket, key }) => ({
          bucket,
          key,
          result: await admin.storage.from(bucket).remove([key]),
        })),
      );
      const failed = removals.filter(({ result }) => result.error);
      if (failed.length) {
        const { error } = await admin.from("profile_cleanup_jobs").upsert(
          failed.map(({ bucket, key }) => ({
            profile_id: access.userId,
            bucket_id: bucket,
            object_key: key,
          })),
          { onConflict: "bucket_id,object_key" },
        );
        cleanupQueueFailed = Boolean(error);
      }
    } else {
      const { data: committed, error: lookupError } = await admin
        .from("profile_avatar_assets")
        .select("id")
        .or(`source_key.eq.${sourceKey},derived_key.eq.${derivedKey}`)
        .limit(1);
      if (lookupError) {
        outcomeUnknown = true;
      } else if (!committed?.length) {
        const { error } = await admin.from("profile_cleanup_jobs").upsert(
          uploaded.map(({ bucket, key }) => ({
            profile_id: access.userId,
            bucket_id: bucket,
            object_key: key,
          })),
          { onConflict: "bucket_id,object_key" },
        );
        cleanupQueueFailed = Boolean(error);
      }
    }
    if (cleanupQueueFailed)
      return problem(
        503,
        "avatar_cleanup_unavailable",
        "Your avatar could not be saved and cleanup could not be queued. Try again.",
      );
    if (outcomeUnknown)
      return problem(
        503,
        "avatar_outcome_unknown",
        "Avatar save status is unknown. Retry the same avatar upload.",
      );
    return problem(
      503,
      "avatar_not_saved",
      "Your avatar could not be saved. Try again.",
    );
  }
}

function problem(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}
