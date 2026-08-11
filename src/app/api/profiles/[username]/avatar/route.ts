import { NextResponse } from "next/server";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ username: string }> };

export async function GET(_request: Request, { params }: Props) {
  const username = (await params).username.toLowerCase();
  const publicClient = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();
  const { data: details, error: detailsError } = await publicClient.rpc(
    "get_public_profile_details",
    { p_username: username },
  );
  if (detailsError) return new NextResponse(null, { status: 503 });
  const profile = details?.[0];
  if (!profile?.username || profile.availability !== "PUBLIC") {
    return new NextResponse(null, { status: 404 });
  }
  const { data: owner } = await admin
    .from("profiles")
    .select("user_id")
    .eq("username", profile.username)
    .eq("participation_state", "ACTIVE")
    .not("onboarding_completed_at", "is", null)
    .maybeSingle();
  if (!owner) return new NextResponse(null, { status: 404 });
  const { data: asset } = await admin
    .from("profile_avatar_assets")
    .select("derived_bucket, derived_key")
    .eq("profile_id", owner.user_id)
    .eq("state", "ACTIVE")
    .maybeSingle();
  if (!asset) return new NextResponse(null, { status: 404 });
  const { data: blob, error } = await admin.storage
    .from(asset.derived_bucket)
    .download(asset.derived_key);
  if (error || !blob) return new NextResponse(null, { status: 404 });
  return new NextResponse(await blob.arrayBuffer(), {
    headers: {
      "cache-control": "no-store",
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
    },
  });
}
