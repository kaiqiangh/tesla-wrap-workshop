import { NextResponse } from "next/server";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) return unavailable();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("get_public_wrap_media", {
    p_slug: slug,
  });
  const media = data?.[0];
  if (error || !media) return unavailable();
  const stored = await admin.storage
    .from("wrap-derived")
    .download(media.object_key);
  if (stored.error || !stored.data) return unavailable();
  return new NextResponse(await stored.data.arrayBuffer(), {
    headers: {
      "cache-control": "private, max-age=300",
      "content-type": "image/png",
      etag: `"${media.sha256}"`,
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

function unavailable() {
  return NextResponse.json(
    { error: { code: "WF-WRAP-MEDIA-UNAVAILABLE" } },
    {
      status: 404,
      headers: {
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    },
  );
}
