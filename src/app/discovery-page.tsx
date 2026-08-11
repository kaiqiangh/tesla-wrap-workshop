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

import { Brand } from "./brand";
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
      <header className="site-header">
        <Brand href="/" />
        <nav className="desktop-nav" aria-label="Discovery navigation">
          <Link href="/">Homepage</Link>
          <Link href="/explore">Explore</Link>
          <Link href="/trending">Trending</Link>
          <Link href="/upload">Upload a Wrap</Link>
        </nav>
      </header>
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
