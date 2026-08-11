import { NextResponse } from "next/server";

import { hmacPrincipal, requestNetworkPrincipal } from "../../../../lib/limits";
import { readServerEnvironment } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return problem(400, "WF-AUTH-OTP-REQUEST", "The OTP request is invalid.");
  }
  if (!isInput(input)) {
    return problem(400, "WF-AUTH-OTP-REQUEST", "The OTP request is invalid.");
  }

  const env = readServerEnvironment(process.env);
  if (!sameOriginRequest(request, env.NEXT_PUBLIC_SITE_URL)) {
    return problem(
      403,
      "WF-AUTH-OTP-CSRF",
      "This sign-in request must come from WrapForge.",
    );
  }

  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return problem(400, "WF-AUTH-OTP-REQUEST", "Enter a valid email address.");
  }
  const emailPrincipal = hmacPrincipal(
    env.DOWNLOAD_PRINCIPAL_HMAC_SECRET,
    "email",
    email,
  );
  const networkPrincipal = hmacPrincipal(
    env.DOWNLOAD_PRINCIPAL_HMAC_SECRET,
    "network",
    requestNetworkPrincipal(request),
  );
  const admin = createAdminSupabaseClient();
  if (input.action === "verify") {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: input.token,
      type: "email",
    });
    if (error) {
      const failure = await admin.rpc("consume_otp_failure_limit", {
        p_email_principal: emailPrincipal,
        p_network_principal: networkPrincipal,
      });
      if (
        failure.error?.message === "otp_failure_email_rate_limited" ||
        failure.error?.message === "otp_failure_network_rate_limited"
      ) {
        return problem(
          429,
          "WF-AUTH-OTP-FAILURES",
          "Too many invalid codes were entered.",
          failure.error.message === "otp_failure_email_rate_limited"
            ? "3600"
            : "600",
        );
      }
      if (failure.error) {
        return problem(
          503,
          "WF-AUTH-OTP-DATABASE",
          "OTP protection is temporarily unavailable.",
        );
      }
      return problem(
        400,
        "WF-AUTH-OTP-CODE",
        "That code is invalid or expired.",
      );
    }
    return NextResponse.json(
      { verified: true },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const limit = await admin.rpc("consume_otp_limit", {
    p_email_principal: emailPrincipal,
    p_network_principal: networkPrincipal,
  });
  if (limit.error) {
    if (limit.error.message === "otp_email_minute_rate_limited") {
      return problem(
        429,
        "WF-AUTH-OTP-RATE",
        "Wait before requesting another code.",
        "60",
      );
    }
    if (limit.error.message === "otp_email_hour_rate_limited") {
      return problem(
        429,
        "WF-AUTH-OTP-RATE",
        "Email sign-in requests are temporarily limited.",
        "3600",
      );
    }
    if (limit.error.message === "otp_network_rate_limited") {
      return problem(
        429,
        "WF-AUTH-OTP-RATE",
        "OTP requests from this network are temporarily limited.",
        "3600",
      );
    }
    return problem(
      503,
      "WF-AUTH-OTP-DATABASE",
      "OTP protection is temporarily unavailable.",
    );
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error)
    return problem(
      503,
      "WF-AUTH-OTP-SEND",
      "We could not send a code right now.",
    );
  return NextResponse.json(
    { sent: true },
    { headers: { "cache-control": "no-store" } },
  );
}

function isInput(
  value: unknown,
): value is { action: "send" | "verify"; email: string; token: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) =>
      ["action", "email", "token"].includes(key),
    ) &&
    (record.action === "send" || record.action === "verify") &&
    typeof record.email === "string" &&
    record.email.length <= 320 &&
    (record.action === "send" ||
      (typeof record.token === "string" && /^[0-9]{6}$/.test(record.token)))
  );
}

function sameOriginRequest(request: Request, siteUrl?: string) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    (!origin || !siteUrl || origin === siteUrl) && fetchSite !== "cross-site"
  );
}

function problem(
  status: number,
  code: string,
  message: string,
  retryAfter?: string,
) {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...(retryAfter ? { "retry-after": retryAfter } : {}),
      },
    },
  );
}
