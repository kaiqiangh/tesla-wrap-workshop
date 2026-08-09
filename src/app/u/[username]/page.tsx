import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const username = (await params).username.toLowerCase();
  return { title: `@${username} | WrapForge` };
}

export default async function PublicProfilePage({ params }: Props) {
  const rawUsername = (await params).username;
  const username = rawUsername.toLowerCase();
  if (rawUsername !== username) permanentRedirect(`/u/${username}`);

  const supabase = await createServerSupabaseClient();
  const { data: profile, error } = await supabase
    .from("public_profiles")
    .select("username, display_name, bio")
    .eq("username", username)
    .maybeSingle();
  if (error) throw new Error("Profile is temporarily unavailable");
  if (!profile?.username || !profile.display_name) notFound();

  return (
    <main className="profile-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="WrapForge home">
          <span className="brand-mark" aria-hidden="true">
            W
          </span>
          <span>WRAPFORGE</span>
        </Link>
        <Link className="text-link" href="/upload">
          Upload a Wrap
        </Link>
      </header>
      <section className="profile-identity" aria-labelledby="profile-name">
        <div className="profile-avatar" aria-hidden="true">
          {profile.display_name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <p className="eyebrow">COMMUNITY PROFILE</p>
          <h1 id="profile-name">{profile.display_name}</h1>
          <p className="profile-username">@{profile.username}</p>
          {profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
        </div>
      </section>
      <section className="profile-empty" aria-labelledby="profile-wraps">
        <p className="eyebrow">PUBLISHED WRAPS</p>
        <h2 id="profile-wraps">No published wraps yet.</h2>
        <p>
          This Profile is ready. Its first Custom Wrap will appear here after
          publication.
        </p>
      </section>
    </main>
  );
}
