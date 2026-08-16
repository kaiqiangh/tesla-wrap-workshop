import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { Brand } from "../../brand";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = {
  title: "Profile settings | WrapForge",
  robots: { index: false, follow: false },
};

export default async function ProfileSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const access = await readProfileAccess(supabase);
  if (access.status === "guest")
    redirect("/sign-in?next=%2Fsettings%2Fprofile");
  if (access.status !== "active") redirect("/onboarding");
  const { data, error } = await supabase.rpc("get_public_profile_details", {
    p_username: access.username,
  });
  const profile = data?.[0];
  if (error || !profile) redirect("/sign-in?error=profile_unavailable");
  return (
    <main className="profile-settings-shell">
      <header className="site-header">
        <Brand />
        <nav className="desktop-nav" aria-label="Profile settings navigation">
          <Link className="text-link" href={`/u/${access.username}`}>
            View public Profile
          </Link>
          <Link className="text-link" href="/favorites">
            My Favorites
          </Link>
        </nav>
      </header>
      <section
        className="profile-settings"
        aria-labelledby="profile-settings-title"
      >
        <p className="eyebrow">PROFILE SETTINGS</p>
        <h1 id="profile-settings-title">Make your identity yours.</h1>
        <p>
          Edit the public fields only. Auth identity, roles, and moderation
          state stay private.
        </p>
        <ProfileForm
          username={profile.username ?? access.username}
          displayName={profile.display_name ?? ""}
          bio={profile.bio ?? ""}
        />
      </section>
    </main>
  );
}
