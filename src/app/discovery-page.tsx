import Link from "next/link";

import type { DiscoveryResult, PublicVehicleModel } from "@/lib/discovery";

import { Brand } from "./brand";
import { DiscoveryGrid, DiscoveryState } from "./discovery-card";

export function DiscoveryPage({
  eyebrow,
  title,
  intro,
  result,
  model,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  result: DiscoveryResult;
  model?: PublicVehicleModel;
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
      </section>
      <section className="discovery-results" aria-label={`${title} results`}>
        {result.status === "ok" ? (
          <DiscoveryGrid wraps={result.wraps} />
        ) : (
          <DiscoveryState state={result.status} label="DISCOVERY SET" />
        )}
      </section>
    </main>
  );
}
