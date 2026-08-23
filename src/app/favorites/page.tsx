import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { readProfileAccess } from "@/lib/auth/profile-access";
import type { DiscoveryWrap } from "@/lib/discovery";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { SiteHeader } from "../../components/site-header";
import { DiscoveryGrid, DiscoveryState } from "../discovery-card";

export const metadata: Metadata = {
  title: "My Favorites | WrapForge",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ page?: string }>;
};

export default async function FavoritesPage({ searchParams }: Props) {
  const access = await readProfileAccess();
  if (access.status === "guest") {
    redirect("/sign-in?next=%2Ffavorites");
  }
  if (access.status === "incomplete") {
    redirect("/onboarding?next=%2Ffavorites");
  }
  if (access.status === "unavailable") {
    redirect("/sign-in?error=profile_unavailable&next=%2Ffavorites");
  }

  const requestedPage = Number((await searchParams).page ?? "1");
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("get_my_favorites", {
    p_offset: (page - 1) * 24,
    p_limit: 25,
  });
  const favorites = (data ?? []) as DiscoveryWrap[];
  const visible = favorites.slice(0, 24);

  return (
    <main className="discovery-shell">
      <SiteHeader
        label="Favorites navigation"
        links={[
          { href: `/u/${access.username}`, label: "Profile" },
          { href: "/settings/profile", label: "Settings" },
          { href: "/upload", label: "Upload a Wrap" },
        ]}
      />
      <section className="discovery-heading" aria-labelledby="favorites-title">
        <p className="eyebrow">PRIVATE ACCOUNT</p>
        <h1 id="favorites-title">Your Favorites.</h1>
        <p>
          Saved Wraps are visible only to you. Cards disappear here while their
          current public compatibility or Creator eligibility is unavailable.
        </p>
      </section>
      <section className="discovery-results" aria-label="Favorite Wraps">
        {error ? (
          <DiscoveryState
            state="error"
            label="PRIVATE FAVORITES"
            clearHref="/favorites"
          />
        ) : visible.length ? (
          <DiscoveryGrid wraps={visible} />
        ) : (
          <DiscoveryState state="empty" label="PRIVATE FAVORITES" />
        )}
        {!error && favorites.length > 24 && (
          <Link
            className="button discovery-load-more"
            href={`/favorites?page=${page + 1}`}
          >
            Load more
          </Link>
        )}
      </section>
    </main>
  );
}
