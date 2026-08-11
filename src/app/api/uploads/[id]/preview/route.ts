import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return unavailable();
  const supabase = await createServerSupabaseClient();
  const access = await readProfileAccess(supabase);
  if (access.status !== "active") return unavailable();
  const admin = createAdminSupabaseClient();
  const { data: pending, error: pendingError } = await admin.rpc(
    "get_pending_upload_for_owner",
    { p_id: id, p_owner: access.userId },
  );
  const revisionId = pending?.[0]?.asset_revision_id;
  if (pendingError || !revisionId) return unavailable();
  const { data: media, error: mediaError } = await admin
    .from("wrap_assets")
    .select("object_key, byte_size, sha256")
    .eq("asset_revision_id", revisionId)
    .eq("kind", "PREVIEW")
    .maybeSingle();
  if (mediaError || !media) return unavailable();
  const stored = await admin.storage
    .from("wrap-derived")
    .download(media.object_key);
  if (stored.error || !stored.data) return unavailable();
  return new NextResponse(await stored.data.arrayBuffer(), {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "image/png",
      etag: `"${media.sha256}"`,
    },
  });
}

function unavailable() {
  return NextResponse.json(
    { error: { code: "WF-UPLOAD-PREVIEW-UNAVAILABLE" } },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}
