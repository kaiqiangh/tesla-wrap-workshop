import Link from "next/link";
import type { ReactNode } from "react";

import type {
  DiscoveryResult,
  DiscoverySearchResult,
  PublicVehicleModel,
} from "@/lib/discovery";
import {
  discoveryQueryString,
  type DiscoveryQuery,
} from "@/lib/discovery-query";

import { SiteHeader } from "../components/site-header";
import { DiscoveryGrid, DiscoveryState } from "./discovery-card";

export function DiscoveryPage({
  eyebrow,
  title,
  intro,
  result,
  model,
  filters,
  query,
  loadMorePath = "/explore",
}: {
  eyebrow: string;
  title: string;
  intro: string;
  result: DiscoveryResult | DiscoverySearchResult;
  model?: PublicVehicleModel;
  filters?: ReactNode;
  query?: DiscoveryQuery;
  loadMorePath?: string;
}) {
  return (
    <main className="discovery-shell">
      <SiteHeader
        label="Discovery navigation"
        links={[
          { href: "/", label: "Homepage" },
          { href: "/explore", label: "Explore" },
          { href: "/trending", label: "Trending" },
          { href: "/upload", label: "Upload a Wrap" },
        ]}
      />
      <section className="discovery-heading" aria-labelledby="discovery-title">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="discovery-title">{title}</h1>
        <p>{intro}</p>
        {model && (
          <p className="model-caveat">
            Vehicle Model grouping is a browse aid, not a complete VIN, year, or
            trim fit claim.
          </p>
        )}
        {filters}
        {(result.status === "ok" || result.status === "empty") &&
          result.rankingStatus && (
            <p className="discovery-ranking-note">
              {result.rankingStatus === "FALLBACK_NEWEST"
                ? "Trending is temporarily using Newest"
                : `Ranking ${result.rankingStatus.toLowerCase()}`}{" "}
              · calculated {result.calculatedAt}
            </p>
          )}
      </section>
      <section className="discovery-results" aria-label={`${title} results`}>
        {result.status === "ok" ? (
          <DiscoveryGrid wraps={result.wraps} />
        ) : (
          <DiscoveryState
            state={result.status}
            label="DISCOVERY SET"
            clearHref={query ? loadMorePath : undefined}
          />
        )}
        {result.status === "ok" &&
          "nextCursor" in result &&
          result.nextCursor &&
          query && (
            <Link
              className="button discovery-load-more"
              href={`${loadMorePath}?${discoveryQueryString({
                ...query,
                cursor: result.nextCursor,
              })}`}
            >
              Load more
            </Link>
          )}
      </section>
    </main>
  );
}
