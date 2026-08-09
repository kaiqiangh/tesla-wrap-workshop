import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { readPublicEnvironment } from "./env";

export type CatalogModel = {
  id: string;
  slug: string;
  displayName: string;
  variants: {
    id: string;
    key: string;
    displayName: string;
    dimensions: string;
    width: number;
    height: number;
    maxBytes: number;
    state: "Active";
    verifiedAt: string;
    sourceUrl: string;
  }[];
};

export async function getCatalog(): Promise<CatalogModel[]> {
  const env = readPublicEnvironment(process.env);
  const supabase = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );
  const [modelsResult, variantsResult] = await Promise.all([
    supabase
      .from("vehicle_models")
      .select("id, slug, display_name, sort_order")
      .order("sort_order"),
    supabase
      .from("template_variants")
      .select(
        "id, vehicle_model_id, catalog_key, display_name, width_px, height_px, max_file_bytes, verified_at, source_url",
      )
      .order("display_name"),
  ]);

  if (modelsResult.error)
    throw new Error(
      `Catalog models unavailable: ${modelsResult.error.message}`,
    );
  if (variantsResult.error)
    throw new Error(
      `Catalog variants unavailable: ${variantsResult.error.message}`,
    );

  return modelsResult.data.map((model) => ({
    id: model.id,
    slug: model.slug,
    displayName: model.display_name,
    variants: variantsResult.data
      .filter((variant) => variant.vehicle_model_id === model.id)
      .map((variant) => ({
        id: variant.id,
        key: variant.catalog_key,
        displayName: variant.display_name,
        dimensions: `${variant.width_px}×${variant.height_px}`,
        width: variant.width_px,
        height: variant.height_px,
        maxBytes: variant.max_file_bytes,
        state: "Active",
        verifiedAt: variant.verified_at,
        sourceUrl: variant.source_url,
      })),
  }));
}
