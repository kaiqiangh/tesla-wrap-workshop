import type { Metadata } from "next";

import { DiscoveryFilters } from "../discovery-filters";
import { DiscoveryPage } from "../discovery-page";
import { getCatalog } from "@/lib/catalog";
import { searchDiscoveryWrapsForPage } from "@/lib/discovery";
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
  let catalog: Awaited<ReturnType<typeof getCatalog>> = [];
  let catalogUnavailable = false;
  try {
    catalog = await getCatalog();
  } catch {
    catalogUnavailable = true;
  }
  const safeQuery: DiscoveryQuery = query ?? { sort: "NEWEST" };
  const result =
    query === null
      ? { status: "invalid" as const, wraps: [] as [], nextCursor: null }
      : catalogUnavailable
        ? { status: "error" as const, wraps: [] as [], nextCursor: null }
        : await searchDiscoveryWrapsForPage(client, {
            q: query.q,
            modelSlug: query.model,
            variantKey: query.variant,
            sort: query.sort,
            cursor: query.cursor,
          });
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
