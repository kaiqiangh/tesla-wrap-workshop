import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { beginOperation, logOperation } from "@/lib/observability";
import { readPublicEnvironment } from "@/lib/env";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";
import { baseSecurityHeaders, securityHeaders } from "@/lib/security-headers";

export async function proxy(request: NextRequest) {
  if (isCrossSiteMutation(request)) {
    const operation = beginOperation(request, "CSRF_ORIGIN", "AUTH");
    logOperation(operation, "denied", "WF-CSRF-ORIGIN");
    const response = NextResponse.json(
      {
        error: {
          code: "WF-CSRF-ORIGIN",
          message: "State-changing requests must come from the same site.",
        },
      },
      {
        status: 403,
        headers: {
          "cache-control": "no-store",
          "x-correlation-id": operation.correlationId,
        },
      },
    );
    try {
      const env = readPublicEnvironment(process.env);
      for (const [name, value] of Object.entries(
        securityHeaders(
          crypto.randomUUID().replaceAll("-", ""),
          env.NEXT_PUBLIC_SUPABASE_URL,
          env.NEXT_PUBLIC_SITE_URL,
          env.WRAPFORGE_ENVIRONMENT,
        ),
      )) {
        response.headers.set(name, value);
      }
    } catch {
      for (const [name, value] of Object.entries(baseSecurityHeaders()))
        response.headers.set(name, value);
    }
    return response;
  }
  return refreshSupabaseSession(request);
}

function isCrossSiteMutation(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) return false;
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method))
    return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
