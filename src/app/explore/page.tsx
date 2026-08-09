import type { Metadata } from "next";

import { DiscoveryPage } from "../discovery-page";
import { getDiscoveryWraps } from "@/lib/discovery";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore the Discovery Set | WrapForge",
  description:
    "Browse published Tesla Custom Wrap artwork by exact Template Variant.",
  alternates: { canonical: "/explore" },
};

export default async function ExplorePage() {
  const client = await createServerSupabaseClient();
  const result = await getDiscoveryWraps(client, "NEWEST");
  return (
    <DiscoveryPage
      eyebrow="DISCOVERY SET"
      title="Explore the gallery."
      intro="Browse published artwork backed by the exact official Template Variant and a complete Derived Wrap Asset."
      result={result}
    />
  );
}
