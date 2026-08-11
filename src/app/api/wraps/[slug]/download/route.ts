import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { observeRoute, type OperationContext } from "@/lib/observability";
import {
  createGuestToken,
  GUEST_DOWNLOAD_COOKIE,
  GUEST_DOWNLOAD_COOKIE_MAX_AGE,
  guestPrincipalHash,
} from "@/lib/download/principal";
import { safeDownloadFilename } from "@/lib/download/filename";
import { readServerEnvironment } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { wrapProblem } from "@/lib/wraps/problem";

export const runtime = "nodejs";

export function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  return observeRoute(request, "WRAP_DOWNLOAD", "DOWNLOAD", (operation) =>
    post(request, context, operation),
  );
}

async function post(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
  operation: OperationContext,
) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) {
    return downloadProblem(
      404,
      "WF-DOWNLOAD-UNAVAILABLE",
      "That Wrap is unavailable.",
    );
  }

  let environment: ReturnType<typeof readServerEnvironment>;
  let access: Awaited<ReturnType<typeof readProfileAccess>>;
  try {
    environment = readServerEnvironment(process.env);
    if (!sameOriginRequest(request, environment.NEXT_PUBLIC_SITE_URL)) {
      return downloadProblem(
        403,
        "WF-DOWNLOAD-CSRF",
        "This download request did not come from the WrapForge site.",
      );
    }
    const supabase = await createServerSupabaseClient();
    access = await readProfileAccess(supabase);
  } catch {
    return databaseProblem();
  }
  if (access.status === "unavailable" || access.status === "incomplete") {
    return downloadProblem(
      403,
      "WF-DOWNLOAD-AUTH",
      "Your Profile cannot download right now.",
    );
  }
  if (access.status === "active") operation.actorId = access.userId;

  const cookieStore = await cookies();
  const existingToken = cookieStore.get(GUEST_DOWNLOAD_COOKIE)?.value;
  const token = existingToken || createGuestToken();
  const setGuestCookie = access.status === "guest" && !existingToken;
  const admin = createAdminSupabaseClient();
  const userId = access.status === "active" ? access.userId : null;

  const { data: preparedData, error: prepareError } = await admin.rpc(
    "prepare_original_download",
    { p_slug: slug, p_user_id: userId as unknown as string },
  );
  if (prepareError) return mapDatabaseError(prepareError.message);
  const prepared = preparedData?.[0];
  if (!prepared) return databaseProblem();

  const filename = safeDownloadFilename(prepared.title);
  const stored = await admin.storage
    .from("wrap-originals")
    .download(prepared.object_key);
  if (stored.error || !stored.data) {
    return downloadProblem(
      503,
      "WF-DOWNLOAD-STORAGE",
      "The private Original Wrap Asset could not be delivered.",
    );
  }

  const { data: recordedData, error: recordError } = await admin.rpc(
    "record_original_download",
    {
      p_guest_principal_hash: (userId === null
        ? guestPrincipalHash(token, environment.DOWNLOAD_PRINCIPAL_HMAC_SECRET)
        : null) as unknown as string,
      p_user_id: userId as unknown as string,
      p_wrap_id: prepared.wrap_id,
    },
  );
  if (recordError) return mapDatabaseError(recordError.message);
  const recorded = recordedData?.[0];
  if (!recorded) return databaseProblem();

  const response = new NextResponse(await stored.data.arrayBuffer(), {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "image/png",
      "x-download-counted": String(recorded.counted),
      "x-download-filename": filename,
      "x-download-sha256": prepared.sha256,
    },
  });
  if (setGuestCookie) {
    response.cookies.set({
      name: GUEST_DOWNLOAD_COOKIE,
      value: token,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: GUEST_DOWNLOAD_COOKIE_MAX_AGE,
    });
  }
  return response;
}

function sameOriginRequest(request: Request, siteUrl: string) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    (!origin || origin === siteUrl) &&
    (!fetchSite ||
      fetchSite === "same-origin" ||
      fetchSite === "same-site" ||
      fetchSite === "none")
  );
}

function mapDatabaseError(message: string) {
  if (message === "download_minute_rate_limited") {
    return downloadProblem(
      429,
      "WF-DOWNLOAD-RATE",
      "Download activity is temporarily limited.",
      { "retry-after": "60" },
    );
  }
  if (message === "download_hour_rate_limited") {
    return downloadProblem(
      429,
      "WF-DOWNLOAD-RATE",
      "Download activity is temporarily limited.",
      { "retry-after": "3600" },
    );
  }
  if (message === "download_unavailable") {
    return downloadProblem(
      404,
      "WF-DOWNLOAD-UNAVAILABLE",
      "That Wrap is unavailable.",
    );
  }
  if (message === "download_creator_unavailable") {
    return downloadProblem(
      403,
      "WF-DOWNLOAD-CREATOR",
      "This Wrap is temporarily unavailable because its Creator Profile is not Active.",
    );
  }
  if (message === "download_auth") {
    return downloadProblem(
      403,
      "WF-DOWNLOAD-AUTH",
      "Your Profile cannot download right now.",
    );
  }
  if (message === "download_object_missing") {
    return downloadProblem(
      409,
      "WF-DOWNLOAD-ASSET",
      "The private Original Wrap Asset is no longer available.",
    );
  }
  if (message === "download_principal_invalid") {
    return downloadProblem(
      400,
      "WF-DOWNLOAD-PRINCIPAL",
      "The download session is invalid.",
    );
  }
  return databaseProblem();
}

function downloadProblem(
  status: number,
  code: string,
  problem: string,
  headers: HeadersInit = {},
) {
  return wrapProblem(
    status,
    code,
    problem,
    "Published Original Wrap Assets are served only through the private delivery endpoint.",
    "Retry the download after checking the Wrap and your Profile state.",
    headers,
  );
}

function databaseProblem() {
  return downloadProblem(
    503,
    "WF-DOWNLOAD-DATABASE",
    "The download could not be recorded safely.",
  );
}
