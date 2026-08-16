import { NextResponse } from "next/server";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(
  request: Request,
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
  const etag = `"${media.sha256}"`;
  const headers = {
    "cache-control": "public, max-age=0, must-revalidate",
    etag,
    "x-robots-tag": "noindex, nofollow, noarchive",
  };
  if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  const stored = await admin.storage
    .from("wrap-derived")
    .download(media.object_key);
  if (stored.error || !stored.data) return unavailable();
  return new NextResponse(await stored.data.arrayBuffer(), {
    headers: {
      ...headers,
      "content-type": "image/png",
    },
  });
}

function matchesIfNoneMatch(value: string | null, etag: string) {
  return (
    value?.split(",").some((candidate) => {
      const trimmed = candidate.trim();
      return trimmed === "*" || trimmed === etag || trimmed === `W/${etag}`;
    }) ?? false
  );
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
