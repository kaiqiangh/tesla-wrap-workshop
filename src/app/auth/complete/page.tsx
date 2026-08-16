import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { readProfileAccessOrRedirect } from "@/lib/auth/entry-access";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CompleteSignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  const access = await readProfileAccessOrRedirect(next);

  if (access.status === "active") redirect(next);
  if (access.status === "incomplete") {
    redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  }
  redirect(
    `/sign-in?error=${access.status === "guest" ? "session_failed" : "profile_unavailable"}&next=${encodeURIComponent(next)}`,
  );
}
