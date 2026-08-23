export type DiscoveryKind = "TRENDING" | "NEWEST" | "MODEL";
export type DiscoverySort = "TRENDING" | "NEWEST" | "MOST_DOWNLOADED";
export type DiscoveryRankingStatus = "LIVE" | "STALE" | "FALLBACK_NEWEST";

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
  liked: boolean;
  favorited: boolean;
  preview_width_px: number;
  preview_height_px: number;
  preview_available: boolean;
  availability_caveat: string;
};

export type DiscoveryResult =
  | {
      status: "ok";
      wraps: DiscoveryWrap[];
      calculatedAt?: string;
      rankingStatus?: DiscoveryRankingStatus;
    }
  | {
      status: "empty";
      wraps: [];
      calculatedAt?: string;
      rankingStatus?: DiscoveryRankingStatus;
    }
  | { status: "missing"; wraps: [] }
  | { status: "invalid"; wraps: [] }
  | { status: "error"; wraps: [] };

export type DiscoverySearchResult =
  | {
      status: "ok";
      wraps: DiscoveryWrap[];
      nextCursor: string | null;
      calculatedAt: string;
      rankingStatus: DiscoveryRankingStatus;
    }
  | {
      status: "empty";
      wraps: [];
      nextCursor: null;
      calculatedAt: string;
      rankingStatus: DiscoveryRankingStatus;
    }
  | { status: "invalid"; wraps: []; nextCursor: null }
  | { status: "rate_limited"; wraps: []; nextCursor: null }
  | { status: "error"; wraps: []; nextCursor: null };

export type PublicVehicleModel = {
  slug: string;
  display_name: string;
  sort_order: number;
};

type DiscoveryClient = {
  auth?: {
    getUser?: () => PromiseLike<{
      data: { user: { id: string } | null };
    }>;
  };
  rpc: {
    (
      name: "get_public_vehicle_model",
      args: { p_slug: string },
    ): PromiseLike<{ data: unknown; error: unknown }>;
    (
      name: "search_discovery_wraps",
      args: {
        p_cursor?: string;
        p_limit?: number;
        p_model_slug?: string;
        p_q?: string;
        p_sort?: DiscoverySort;
        p_variant_key?: string;
      },
    ): PromiseLike<{ data: unknown; error: unknown }>;
    (
      name: "search_discovery_wraps_for_principal",
      args: {
        p_cursor?: string;
        p_limit?: number;
        p_model_slug?: string;
        p_principal_key: string;
        p_q?: string;
        p_sort?: DiscoverySort;
        p_variant_key?: string;
        p_viewer_id?: string | null;
      },
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
};

export async function getDiscoveryWraps(
  client: DiscoveryClient,
  kind: DiscoveryKind,
  options: { modelSlug?: string; limit?: number } = {},
): Promise<DiscoveryResult> {
  const result = await searchDiscoveryWraps(client, {
    sort: kind === "TRENDING" ? "TRENDING" : "NEWEST",
    modelSlug: kind === "MODEL" ? options.modelSlug : undefined,
    limit: options.limit ?? 24,
  });
  if (result.status === "ok") {
    return {
      status: "ok",
      wraps: result.wraps,
      calculatedAt: result.calculatedAt,
      rankingStatus: result.rankingStatus,
    };
  }
  if (result.status === "empty") {
    return {
      status: "empty",
      wraps: [],
      calculatedAt: result.calculatedAt,
      rankingStatus: result.rankingStatus,
    };
  }
  if (result.status === "invalid") return { status: "invalid", wraps: [] };
  return { status: "error", wraps: [] };
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

export async function searchDiscoveryWraps(
  client: DiscoveryClient,
  options: {
    q?: string;
    modelSlug?: string;
    variantKey?: string;
    sort?: DiscoverySort;
    cursor?: string;
    limit?: number;
  } = {},
): Promise<DiscoverySearchResult> {
  let principal: string | undefined;
  try {
    principal = await readSearchPrincipal();
  } catch {
    return { status: "error", wraps: [], nextCursor: null };
  }
  const args = {
    ...(options.q ? { p_q: options.q } : {}),
    ...(options.modelSlug ? { p_model_slug: options.modelSlug } : {}),
    ...(options.variantKey ? { p_variant_key: options.variantKey } : {}),
    p_sort: options.sort ?? "NEWEST",
    ...(options.cursor ? { p_cursor: options.cursor } : {}),
    p_limit: options.limit ?? 24,
  };
  let data: unknown;
  let error: unknown;
  try {
    if (principal) {
      const viewerId = await readViewerId(client);
      const { createAdminSupabaseClient } = await import("./supabase/admin");
      ({ data, error } = await createAdminSupabaseClient().rpc(
        "search_discovery_wraps_for_principal",
        {
          ...args,
          p_principal_key: principal,
          p_viewer_id: viewerId ?? undefined,
        },
      ));
    } else {
      ({ data, error } = await client.rpc("search_discovery_wraps", args));
    }
  } catch {
    return { status: "error", wraps: [], nextCursor: null };
  }
  if (error) {
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "";
    if (message.includes("invalid_discovery_")) {
      return { status: "invalid", wraps: [], nextCursor: null };
    }
    if (message === "search_rate_limited") {
      return { status: "rate_limited", wraps: [], nextCursor: null };
    }
    if (options.sort === "TRENDING" && !options.cursor) {
      const fallback = await searchDiscoveryWraps(client, {
        ...options,
        sort: "NEWEST",
      });
      if (fallback.status === "ok" || fallback.status === "empty") {
        return { ...fallback, rankingStatus: "FALLBACK_NEWEST" };
      }
    }
    return { status: "error", wraps: [], nextCursor: null };
  }
  if (!data || typeof data !== "object") {
    return { status: "error", wraps: [], nextCursor: null };
  }
  const payload = data as {
    items?: unknown;
    next_cursor?: unknown;
    calculated_at?: unknown;
    ranking_status?: unknown;
  };
  if (
    !Array.isArray(payload.items) ||
    typeof payload.calculated_at !== "string" ||
    !["LIVE", "STALE", "FALLBACK_NEWEST"].includes(
      String(payload.ranking_status),
    )
  ) {
    return { status: "error", wraps: [], nextCursor: null };
  }
  if (process.env.NODE_ENV !== "test") {
    try {
      const viewerId = await readViewerId(client);
      const eventInput = {
        actorId: viewerId,
        targetType: "DISCOVERY" as const,
        targetId: "00000000-0000-4000-8000-000000000000",
        outcome: "SUCCESS" as const,
        code: "DISCOVERY_SEARCH",
        correlationId: null,
      };
      const { recordCoreLoopEvent } = await import("./observability");
      await recordCoreLoopEvent({
        eventKind: "SEARCH",
        ...eventInput,
      });
      if (options.modelSlug || options.variantKey) {
        await recordCoreLoopEvent({
          eventKind: "FILTER_APPLIED",
          ...eventInput,
          code: "DISCOVERY_FILTER",
        });
      }
    } catch {
      // Discovery results remain available when optional telemetry is down.
    }
  }
  const wraps = payload.items as DiscoveryWrap[];
  const calculatedAt = payload.calculated_at;
  const rankingStatus =
    payload.ranking_status === "FALLBACK_NEWEST"
      ? "FALLBACK_NEWEST"
      : payload.ranking_status === "STALE"
        ? "STALE"
        : "LIVE";
  if (wraps.length === 0) {
    return {
      status: "empty",
      wraps: [],
      nextCursor: null,
      calculatedAt,
      rankingStatus,
    };
  }
  return {
    status: "ok",
    wraps,
    nextCursor:
      typeof payload.next_cursor === "string" ? payload.next_cursor : null,
    calculatedAt,
    rankingStatus,
  };
}

async function readSearchPrincipal() {
  try {
    const [
      { cookies, headers },
      { SEARCH_SESSION_COOKIE, headerNetworkPrincipal, searchPrincipal },
    ] = await Promise.all([import("next/headers"), import("./limits")]);
    // Cookieless clients key on their network address so the per-minute
    // search limit still binds; a per-request random principal would let
    // them rotate past it indefinitely.
    const session =
      (await cookies()).get(SEARCH_SESSION_COOKIE)?.value ?? null;
    const network = headerNetworkPrincipal(await headers());
    const secret = process.env.DOWNLOAD_PRINCIPAL_HMAC_SECRET;
    if (!secret) throw new Error("search_principal_unavailable");
    return searchPrincipal(secret, session, network);
  } catch (error) {
    if (process.env.NODE_ENV === "test") return undefined;
    throw error;
  }
}

async function readViewerId(client: DiscoveryClient) {
  try {
    const result = await client.auth?.getUser?.();
    return result?.data.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function searchDiscoveryWrapsForPage(
  client: DiscoveryClient,
  options: Parameters<typeof searchDiscoveryWraps>[1] = {},
): Promise<DiscoverySearchResult> {
  return searchDiscoveryWraps(client, options);
}
