import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { Brand } from "../../brand";
import { ReportDialog } from "../../report-dialog";
import { FollowControl } from "./follow-control";

type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const username = (await params).username.toLowerCase();
  return { title: `@${username} | WrapForge` };
}

export default async function PublicProfilePage({
  params,
  searchParams,
}: Props) {
  const rawUsername = (await params).username;
  const username = rawUsername.toLowerCase();
  const requestedPage = Number((await searchParams).page ?? "1");
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const offset = (page - 1) * 24;
  if (rawUsername !== username) permanentRedirect(`/u/${username}`);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_profile_details", {
    p_username: username,
  });
  const profile = data?.[0];
  if (error) return unavailable("Profile is temporarily unavailable.");
  if (!profile) notFound();
  if (profile.is_alias && profile.username)
    permanentRedirect(`/u/${profile.username}`);
  if (profile.availability !== "PUBLIC") {
    return (
      <main className="profile-shell">
        <header className="site-header">
          <Brand />
        </header>
        <section
          className="profile-empty"
          aria-labelledby="profile-unavailable-title"
        >
          <p className="eyebrow">COMMUNITY PROFILE</p>
          <h1 id="profile-unavailable-title">
            {profile.availability === "TEMPORARILY_UNAVAILABLE"
              ? "This Profile is temporarily unavailable."
              : "This Profile is unavailable."}
          </h1>
          <p>
            It may be incomplete, suspended, or deactivated. Public identity and
            Wraps remain hidden.
          </p>
        </section>
      </main>
    );
  }
  const { data: wraps, error: wrapsError } = await supabase.rpc(
    "get_public_creator_wraps",
    { p_username: username, p_offset: offset },
  );
  if (wrapsError)
    return unavailable("Published Wraps are temporarily unavailable.");

  let initialFollowing = false;
  if (profile.ever_published) {
    try {
      const access = await readProfileAccess(supabase);
      if (access.status === "active") {
        const { data: followState } = await supabase.rpc(
          "get_creator_follow_state",
          { p_username: profile.username },
        );
        initialFollowing = followState?.[0]?.following ?? false;
      }
    } catch {
      initialFollowing = false;
    }
  }

  return (
    <main className="profile-shell">
      <header className="site-header">
        <Brand />
        <Link className="text-link" href="/upload">
          Upload a Wrap
        </Link>
      </header>
      <section className="profile-identity" aria-labelledby="profile-name">
        <div className="profile-avatar">
          {profile.avatar_url ? (
            <Image src={profile.avatar_url} alt="" width={72} height={72} />
          ) : (
            <span aria-hidden="true">
              {profile.display_name?.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div>
          <p className="eyebrow">COMMUNITY PROFILE</p>
          <h1 id="profile-name">{profile.display_name}</h1>
          <p className="profile-username">@{profile.username}</p>
          {profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
          {profile.ever_published ? (
            <FollowControl
              username={profile.username}
              initialFollowing={initialFollowing}
              initialFollowerCount={profile.follower_count}
            />
          ) : null}
          <ReportDialog
            targetKind="USER"
            target={profile.username}
            label="Report Profile"
          />
        </div>
      </section>
      <dl className="profile-stats" aria-label="Creator statistics">
        <div>
          <dt>Followers</dt>
          <dd>{profile.follower_count}</dd>
        </div>
        <div>
          <dt>Published Wraps</dt>
          <dd>{profile.published_wrap_count}</dd>
        </div>
        <div>
          <dt>Counted Downloads</dt>
          <dd>{profile.download_count}</dd>
        </div>
      </dl>
      {wraps.length ? (
        <section className="profile-wraps" aria-labelledby="profile-wraps">
          <p className="eyebrow">PUBLISHED WRAPS</p>
          <h2 id="profile-wraps">
            {profile.published_wrap_count} published Wrap
            {profile.published_wrap_count === 1 ? "" : "s"}.
          </h2>
          <div className="profile-wrap-grid">
            {wraps.map((wrap) => (
              <Link
                className="profile-wrap-card"
                href={`/wrap/${wrap.slug}`}
                key={wrap.id}
              >
                <Image
                  src={`/api/wraps/${wrap.slug}/preview`}
                  alt={`${wrap.title} Derived Wrap Asset`}
                  width={wrap.preview_width_px ?? wrap.width_px}
                  height={wrap.preview_height_px ?? wrap.height_px}
                />
                <span className="eyebrow">{wrap.template_variant_name}</span>
                <strong>{wrap.title}</strong>
                <span>
                  {wrap.width_px}×{wrap.height_px} · Verified {wrap.verified_at}
                </span>
              </Link>
            ))}
          </div>
          {profile.published_wrap_count > offset + wraps.length ? (
            <Link
              className="button discovery-load-more"
              href={`/u/${profile.username}?page=${page + 1}`}
            >
              Load more
            </Link>
          ) : null}
        </section>
      ) : (
        <section className="profile-empty" aria-labelledby="profile-wraps">
          <p className="eyebrow">PUBLISHED WRAPS</p>
          <h2 id="profile-wraps">
            {profile.ever_published
              ? "No published Wraps are available right now."
              : "No published wraps yet."}
          </h2>
          <p>
            {profile.ever_published
              ? "Published Wraps may be temporarily unavailable."
              : "This Profile is ready. Its first Custom Wrap will appear here after publication."}
          </p>
        </section>
      )}
    </main>
  );
}

function unavailable(message: string) {
  return (
    <main className="profile-shell">
      <header className="site-header">
        <Brand />
      </header>
      <section className="profile-empty" aria-labelledby="profile-error-title">
        <p className="eyebrow">COMMUNITY PROFILE</p>
        <h1 id="profile-error-title">{message}</h1>
        <p>Try again shortly. Public identity and Wraps remain protected.</p>
      </section>
    </main>
  );
}
