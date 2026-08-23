import type { Metadata } from "next";

import { DiscoveryFilters } from "../discovery-filters";
import { DiscoveryPage } from "../discovery-page";
import { getCatalog } from "@/lib/catalog";
import {
  searchDiscoveryWrapsForPage,
  type DiscoveryResult,
  type DiscoverySearchResult,
} from "@/lib/discovery";
import {
  parseDiscoveryQuery,
  type DiscoveryQuery,
} from "@/lib/discovery-query";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const raw = await searchParams;
  const hasQuery = Object.keys(raw).length > 0;
  return {
    title: "Explore the Discovery Set | WrapForge",
    description:
      "Browse published Tesla Custom Wrap artwork by exact Template Variant.",
    alternates: { canonical: "/explore" },
    openGraph: {
      title: "Explore the Discovery Set | WrapForge",
      description:
        "Browse published Tesla Custom Wrap artwork by exact Template Variant.",
      url: "/explore",
      type: "website",
    },
    ...(hasQuery ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const raw = await searchParams;
  const query = parseDiscoveryQuery(raw);
  const client = await createServerSupabaseClient();
  // Catalog and search are independent reads: run them concurrently so the
  // page pays one round trip instead of two before first content paint.
  const catalogPromise = getCatalog()
    .then((value) => ({ ok: true as const, value }))
    .catch(() => ({ ok: false as const }));
  const searchPromise =
    query === null
      ? Promise.resolve({
          status: "invalid",
          wraps: [],
        } satisfies DiscoveryResult)
      : searchDiscoveryWrapsForPage(client, {
          q: query.q,
          modelSlug: query.model,
          variantKey: query.variant,
          sort: query.sort,
          cursor: query.cursor,
        });
  const [catalogSettled, result] = await Promise.all([
    catalogPromise,
    searchPromise,
  ]);
  const catalogUnavailable = !catalogSettled.ok;
  const catalog = catalogSettled.ok ? catalogSettled.value : [];
  const safeQuery: DiscoveryQuery = query ?? { sort: "NEWEST" };
  return (
    <DiscoveryPage
      eyebrow="DISCOVERY SET"
      title="Explore the gallery."
      intro="Browse published artwork backed by the exact official Template Variant and a complete Derived Wrap Asset."
      result={result}
      filters={<DiscoveryFilters catalog={catalog} query={safeQuery} />}
      query={safeQuery}
    />
  );
}
