import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "../database.types";
import { readPublicEnvironment } from "../env";

export async function refreshSupabaseSession(request: NextRequest) {
  const env = readPublicEnvironment(process.env);
  let response = NextResponse.next({ request });
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
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getClaims();
  if (!request.cookies.get("wf_search_session")) {
    response.cookies.set("wf_search_session", crypto.randomUUID(), {
      httpOnly: true,
      maxAge: 86_400,
      path: "/",
      sameSite: "lax",
      secure: env.WRAPFORGE_ENVIRONMENT !== "local",
    });
  }
  return response;
}
