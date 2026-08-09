import { NextResponse } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { readPublicEnvironment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const siteUrl = readPublicEnvironment(process.env).NEXT_PUBLIC_SITE_URL;
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL(
        `/sign-in?error=oauth_failed&next=${encodeURIComponent(next)}`,
        siteUrl,
      ),
    );
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(
        `/sign-in?error=oauth_failed&next=${encodeURIComponent(next)}`,
        siteUrl,
      ),
    );
  }

  return NextResponse.redirect(
    new URL(`/auth/complete?next=${encodeURIComponent(next)}`, siteUrl),
  );
}
