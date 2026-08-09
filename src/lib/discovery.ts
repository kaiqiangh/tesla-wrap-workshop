export type DiscoveryKind = "TRENDING" | "NEWEST" | "MODEL";

export type DiscoveryWrap = {
  id: string;
  slug: string;
  title: string;
  description: string;
  creator_username: string;
  creator_display_name: string;
  vehicle_model_slug: string;
  vehicle_model_name: string;
  template_variant_name: string;
  template_variant_key: string;
  width_px: number;
  height_px: number;
  verified_at: string;
  legacy: boolean;
  license_type: string;
  tags: string[];
  first_published_at: string;
  download_count: number;
  like_count: number;
  favorite_count: number;
  comment_count: number;
  preview_width_px: number;
  preview_height_px: number;
  preview_available: boolean;
  availability_caveat: string;
};

export type DiscoveryResult =
  | { status: "ok"; wraps: DiscoveryWrap[] }
  | { status: "empty"; wraps: [] }
  | { status: "missing"; wraps: [] }
  | { status: "error"; wraps: [] };

export type PublicVehicleModel = {
  slug: string;
  display_name: string;
  sort_order: number;
};

type DiscoveryClient = {
  rpc: {
    (
      name: "get_discovery_wraps",
      args: {
        p_kind: DiscoveryKind;
        p_limit: number;
        p_model_slug?: string;
      },
    ): PromiseLike<{ data: unknown; error: unknown }>;
    (
      name: "get_public_vehicle_model",
      args: { p_slug: string },
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
};

export async function getDiscoveryWraps(
  client: DiscoveryClient,
  kind: DiscoveryKind,
  options: { modelSlug?: string; limit?: number } = {},
): Promise<DiscoveryResult> {
  const args = {
    p_kind: kind,
    p_limit: options.limit ?? 24,
    ...(options.modelSlug ? { p_model_slug: options.modelSlug } : {}),
  };
  const { data, error } = await client.rpc("get_discovery_wraps", {
    ...args,
  });
  if (error) return { status: "error", wraps: [] };
  const wraps = (data ?? []) as DiscoveryWrap[];
  return wraps.length > 0
    ? { status: "ok", wraps }
    : { status: "empty", wraps: [] };
}

export async function getPublicVehicleModel(
  client: DiscoveryClient,
  slug: string,
): Promise<
  { status: "ok"; model: PublicVehicleModel } | { status: "missing" | "error" }
> {
  const { data, error } = await client.rpc("get_public_vehicle_model", {
    p_slug: slug,
  });
  if (error) return { status: "error" };
  const model = (data as PublicVehicleModel[] | null)?.[0];
  return model ? { status: "ok", model } : { status: "missing" };
}
