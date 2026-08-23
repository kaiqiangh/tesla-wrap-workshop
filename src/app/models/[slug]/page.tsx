import type { Metadata } from "next";
import { Suspense } from "react";

import { getPublicVehicleModel, searchDiscoveryWraps } from "@/lib/discovery";
import { parseDiscoveryQuery } from "@/lib/discovery-query";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { DiscoveryPage } from "../../discovery-page";
import { DiscoveryLoading } from "../../discovery-loading";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Props = { params: Promise<{ slug: string }>; searchParams: SearchParams };

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { slug } = await params;
  const client = await createServerSupabaseClient();
  const result = await getPublicVehicleModel(client, slug);
  if (result.status !== "ok") {
    return {
      title: "Vehicle Model unavailable | WrapForge",
      robots: { index: false, follow: false },
    };
  }
  const raw = await searchParams;
  return {
    title: `${result.model.display_name} Wraps | WrapForge`,
    description: `Browse published Custom Wraps grouped by ${result.model.display_name}.`,
    alternates: { canonical: `/models/${result.model.slug}` },
    openGraph: {
      title: `${result.model.display_name} Wraps | WrapForge`,
      description: `Browse published Custom Wraps grouped by ${result.model.display_name}.`,
      url: `/models/${result.model.slug}`,
      type: "website",
    },
    ...(Object.keys(raw).length > 0
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}

export default async function VehicleModelPage({
  params,
  searchParams,
}: Props) {
  const { slug } = await params;
  const client = await createServerSupabaseClient();
  const modelPromise = getPublicVehicleModel(client, slug);
  return (
    <Suspense fallback={<DiscoveryLoading />}>
      <VehicleModelContent
        client={client}
        modelPromise={modelPromise}
        rawPromise={searchParams}
      />
    </Suspense>
  );
}

async function VehicleModelContent({
  client,
  modelPromise,
  rawPromise,
}: {
  client: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  modelPromise: ReturnType<typeof getPublicVehicleModel>;
  rawPromise: SearchParams;
}) {
  const modelResult = await modelPromise;
  if (modelResult.status !== "ok") {
    return (
      <DiscoveryPage
        eyebrow="DISCOVERY SET"
        title={
          modelResult.status === "missing"
            ? "Vehicle Model unavailable."
            : "Discovery is temporarily unavailable."
        }
        intro={
          modelResult.status === "missing"
            ? "That model is not part of the active official catalog."
            : "The active catalog could not be loaded safely. Retry shortly."
        }
        result={
          modelResult.status === "missing"
            ? { status: "missing", wraps: [] }
            : { status: "error", wraps: [] }
        }
      />
    );
  }
  const model = modelResult.model;
  const raw = await rawPromise;
  const parsed = parseDiscoveryQuery(raw);
  const rawModel = Array.isArray(raw.model) ? raw.model[0] : raw.model;
  const rawSort = Array.isArray(raw.sort) ? raw.sort[0] : raw.sort;
  const query =
    parsed &&
    (!rawModel || parsed.model === model.slug) &&
    (!rawSort || parsed.sort === "NEWEST")
      ? { ...parsed, model: model.slug, sort: "NEWEST" as const }
      : null;
  const result = query
    ? await searchDiscoveryWraps(client, {
        q: query.q,
        modelSlug: model.slug,
        variantKey: query.variant,
        sort: "NEWEST",
        cursor: query.cursor,
      })
    : { status: "invalid" as const, wraps: [] as [], nextCursor: null };
  return (
    <DiscoveryPage
      eyebrow="VEHICLE MODEL"
      title={`${model.display_name} Wraps`}
      intro={`Browse published Wraps grouped by ${model.display_name} and their exact official Template Variants.`}
      result={result}
      model={model}
      query={query ?? { model: model.slug, sort: "NEWEST" }}
      loadMorePath={`/models/${model.slug}`}
    />
  );
}
