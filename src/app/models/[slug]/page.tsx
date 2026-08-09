import type { Metadata } from "next";

import { getDiscoveryWraps, getPublicVehicleModel } from "@/lib/discovery";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { DiscoveryPage } from "../../discovery-page";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const client = await createServerSupabaseClient();
  const result = await getPublicVehicleModel(client, slug);
  if (result.status !== "ok") {
    return {
      title: "Vehicle Model unavailable | WrapForge",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: `${result.model.display_name} Wraps | WrapForge`,
    description: `Browse published Custom Wraps grouped by ${result.model.display_name}.`,
    alternates: { canonical: `/models/${result.model.slug}` },
  };
}

export default async function VehicleModelPage({ params }: Props) {
  const { slug } = await params;
  const client = await createServerSupabaseClient();
  const modelResult = await getPublicVehicleModel(client, slug);
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
        result={{ status: modelResult.status, wraps: [] }}
      />
    );
  }
  const model = modelResult.model;
  const result = await getDiscoveryWraps(client, "MODEL", {
    modelSlug: model.slug,
  });
  return (
    <DiscoveryPage
      eyebrow="VEHICLE MODEL"
      title={`${model.display_name} Wraps`}
      intro={`Browse published Wraps grouped by ${model.display_name} and their exact official Template Variants.`}
      result={result}
      model={model}
    />
  );
}
