import type { Metadata } from "next";
import { Suspense } from "react";

import {
  searchDiscoveryWraps,
  type DiscoverySearchResult,
} from "@/lib/discovery";
import {
  parseDiscoveryQuery,
  type DiscoveryQuery,
} from "@/lib/discovery-query";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { DiscoveryPage } from "../discovery-page";
import { DiscoveryLoading } from "../discovery-loading";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const raw = await searchParams;
  const filtered = Object.keys(raw).length > 0;
  return {
    title: "Trending Wraps | WrapForge",
    description: "Browse the deterministic seven-day Trending Discovery Set.",
    alternates: { canonical: "/trending" },
    openGraph: {
      title: "Trending Wraps | WrapForge",
      description: "Browse the deterministic seven-day Trending Discovery Set.",
      url: "/trending",
      type: "website",
    },
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function TrendingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const raw = await searchParams;
  const parsed = parseDiscoveryQuery(raw);
  const rawSort = Array.isArray(raw.sort) ? raw.sort[0] : raw.sort;
  const query =
    parsed && (!rawSort || parsed.sort === "TRENDING")
      ? { ...parsed, sort: "TRENDING" as const }
      : null;
  const client = await createServerSupabaseClient();
  const resultPromise: Promise<DiscoverySearchResult> = query
    ? searchDiscoveryWraps(client, {
        q: query.q,
        modelSlug: query.model,
        variantKey: query.variant,
        sort: "TRENDING",
        cursor: query.cursor,
      })
    : Promise.resolve({
        status: "invalid" as const,
        wraps: [] as [],
        nextCursor: null,
      } satisfies DiscoverySearchResult);
  const safeQuery: DiscoveryQuery = query ?? { sort: "TRENDING" };
  return (
    <Suspense fallback={<DiscoveryLoading />}>
      <TrendingContent resultPromise={resultPromise} query={safeQuery} />
    </Suspense>
  );
}

async function TrendingContent({
  resultPromise,
  query,
}: {
  resultPromise: ReturnType<typeof searchDiscoveryWraps>;
  query: DiscoveryQuery;
}) {
  const result = await resultPromise;
  return (
    <DiscoveryPage
      eyebrow="SEVEN-DAY TRENDING"
      title="What the community is seeing."
      intro="Trending balances Counted Downloads, Likes, Favorites, and visible Comments with a deterministic age adjustment."
      result={result}
      query={query}
      loadMorePath="/trending"
    />
  );
}
