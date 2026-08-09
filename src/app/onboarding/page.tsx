import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { safeNextPath } from "@/lib/auth/redirect";

import { Brand } from "../brand";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
  title: "Complete your Profile | WrapForge",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  const access = await readProfileAccess();
  if (access.status === "guest") {
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }
  if (access.status === "unavailable") {
    redirect(
      `/sign-in?error=profile_unavailable&next=${encodeURIComponent(next)}`,
    );
  }
  if (access.status === "active") redirect(next);

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="onboarding-title">
        <Brand />
        <p className="eyebrow">ONE LAST STEP</p>
        <h1 id="onboarding-title">Establish your Profile</h1>
        <p className="auth-intro">
          This public identity will credit every Custom Wrap you publish.
        </p>
        <OnboardingForm next={next} />
      </section>
    </main>
  );
}
