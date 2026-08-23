import { NextResponse } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { readPublicEnvironment } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  readPublicEnvironment(process.env);
  const callbackOrigin = requestUrl.origin;
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return oauthFailure(callbackOrigin, next);
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return oauthFailure(callbackOrigin, next);
  } catch {
    return oauthFailure(callbackOrigin, next);
  }

  return NextResponse.redirect(
    new URL(`/auth/complete?next=${encodeURIComponent(next)}`, callbackOrigin),
  );
}

function oauthFailure(siteUrl: string, next: string) {
  return NextResponse.redirect(
    new URL(
      `/sign-in?error=oauth_failed&next=${encodeURIComponent(next)}`,
      siteUrl,
    ),
  );
}
