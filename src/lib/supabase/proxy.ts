import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "../database.types";
import { readPublicEnvironment } from "../env";
import { securityHeaders } from "../security-headers";

export async function refreshSupabaseSession(request: NextRequest) {
  const env = readPublicEnvironment(process.env);
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const forwardedRequest = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    return headers;
  };
  let response = NextResponse.next({
    request: { headers: forwardedRequest() },
  });
  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({
            request: { headers: forwardedRequest() },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: env.WRAPFORGE_ENVIRONMENT !== "local",
            }),
          );
        },
      },
    },
  );

  await supabase.auth.getClaims();
  const responseCookieNames = new Set(
    response.cookies.getAll().map((cookie) => cookie.name),
  );
  for (const cookie of request.cookies.getAll()) {
    if (
      responseCookieNames.has(cookie.name) ||
      !/-auth-token(?:\.\d+)?$/.test(cookie.name)
    )
      continue;
    response.cookies.set(cookie.name, cookie.value, {
      httpOnly: true,
      maxAge: 2_592_000,
      path: "/",
      sameSite: "lax",
      secure: env.WRAPFORGE_ENVIRONMENT !== "local",
    });
  }
  if (
    request.nextUrl.pathname !== "/api/health" &&
    !request.cookies.get("wf_search_session")
  ) {
    response.cookies.set("wf_search_session", crypto.randomUUID(), {
      httpOnly: true,
      maxAge: 86_400,
      path: "/",
      sameSite: "lax",
      secure: env.WRAPFORGE_ENVIRONMENT !== "local",
    });
  }
  for (const [name, value] of Object.entries(
    securityHeaders(
      nonce,
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SITE_URL,
      env.WRAPFORGE_ENVIRONMENT,
    ),
  )) {
    response.headers.set(name, value);
  }
  return response;
}
