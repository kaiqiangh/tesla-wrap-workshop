import type { MetadataRoute } from "next";

import { readPublicEnvironment } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data, error } = await createAdminSupabaseClient().rpc(
    "get_public_sitemap_entries",
  );
  if (error) throw new Error("Sitemap is temporarily unavailable");
  const siteUrl = new URL(
    readPublicEnvironment(process.env).NEXT_PUBLIC_SITE_URL,
  );

  return (data ?? []).map((entry) => ({
    url: new URL(entry.path, siteUrl).toString(),
    ...(entry.last_modified ? { lastModified: entry.last_modified } : {}),
  }));
}
