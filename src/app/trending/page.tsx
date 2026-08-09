import type { Metadata } from "next";

import { getDiscoveryWraps } from "@/lib/discovery";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { DiscoveryPage } from "../discovery-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trending Wraps | WrapForge",
  description: "Browse the deterministic seven-day Trending Discovery Set.",
  alternates: { canonical: "/trending" },
};

export default async function TrendingPage() {
  const client = await createServerSupabaseClient();
  const result = await getDiscoveryWraps(client, "TRENDING");
  return (
    <DiscoveryPage
      eyebrow="SEVEN-DAY TRENDING"
      title="What the community is seeing."
      intro="Trending balances Counted Downloads, Likes, Favorites, and visible Comments with a deterministic age adjustment."
      result={result}
    />
  );
}
