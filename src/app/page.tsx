import Image from "next/image";
import Link from "next/link";

import { getCatalog, type CatalogModel } from "@/lib/catalog";
import { getDiscoveryWraps, type DiscoveryResult } from "@/lib/discovery";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { Brand } from "./brand";
import { DiscoveryGrid, DiscoveryState } from "./discovery-card";

export const dynamic = "force-dynamic";

export default async function Home() {
  let models: CatalogModel[] = [];
  let catalogError = false;
  try {
    models = await getCatalog();
  } catch {
    catalogError = true;
    models = [];
  }
  const client = await createServerSupabaseClient();
  const [trending, newest] = await Promise.all([
    getDiscoveryWraps(client, "TRENDING", { limit: 8 }),
    getDiscoveryWraps(client, "NEWEST", { limit: 8 }),
  ]);
  const variantCount = models.reduce(
    (total, model) => total + model.variants.length,
    0,
  );

  return (
    <main id="top">
      <header className="site-header">
        <Brand href="#top" />
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#catalog">Models</a>
          <a href="/explore">Explore</a>
          <a href="/sign-in">Sign in</a>
          <a className="button button-small" href="/upload">
            Upload a Wrap
          </a>
        </nav>
        <details className="mobile-nav">
          <summary aria-label="Open navigation">Menu</summary>
          <div>
            <a href="#catalog">Models</a>
            <a href="/explore">Explore</a>
            <a href="/sign-in">Sign in</a>
            <a href="/upload">Upload a Wrap</a>
          </div>
        </details>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">THE COMMUNITY WORKSHOP</p>
          <h1 id="hero-title">
            Make it yours.
            <br />
            Share the road.
          </h1>
          <p className="hero-body">
            Build from Tesla&apos;s published templates, check the exact fit,
            and help the first community gallery take shape.
          </p>
          <div className="hero-actions">
            <a className="button" href="#catalog">
              Choose a Template
            </a>
            <a className="text-link" href="/explore">
              Explore the Gallery <span aria-hidden="true">→</span>
            </a>
          </div>
          <p className="availability">
            <span aria-hidden="true">●</span>{" "}
            {catalogError
              ? "Official catalog temporarily unavailable"
              : `${models.length} vehicle models · ${variantCount} exact template variants available`}
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <Image
            src="/assets/hero-wrap-texture.png"
            alt=""
            fill
            priority
            sizes="(max-width: 800px) 100vw, 55vw"
          />
        </div>
      </section>

      <section
        className="catalog-section"
        id="catalog"
        aria-labelledby="catalog-title"
      >
        <div className="section-heading">
          <p className="eyebrow">OFFICIAL TEMPLATE CATALOG</p>
          <h2 id="catalog-title">Choose the exact canvas.</h2>
          <p>
            Tesla&apos;s names and dimensions, pinned to the source.
            Availability can still vary by vehicle, configuration, and region.
          </p>
        </div>
        <div className="model-grid">
          {models.map((model) => (
            <article className="model-card" key={model.id}>
              <div className="model-card-heading">
                <h3>
                  <Link href={`/models/${model.slug}`}>
                    {model.displayName}
                  </Link>
                </h3>
                <span>{model.variants.length}</span>
              </div>
              <ul>
                {model.variants.map((variant) => (
                  <li key={variant.key}>
                    <a
                      href={variant.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>{variant.displayName}</span>
                      <small>{variant.dimensions} ↗</small>
                    </a>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section
        className="home-discovery"
        id="discovery"
        aria-labelledby="discovery-title"
      >
        <div className="section-heading">
          <p className="eyebrow">COMMUNITY DISCOVERY SET</p>
          <h2 id="discovery-title">Browse the work.</h2>
          <p>
            Only eligible Published Wraps with complete Derived Wrap Assets
            appear here. Browse by model without inferring a VIN, year, or trim
            fit.
          </p>
        </div>
        <HomeDiscoverySection
          title="Trending"
          href="/trending"
          result={trending}
        />
        <div className="home-model-links" aria-label="Vehicle Model pages">
          {models.map((model) => (
            <Link key={model.id} href={`/models/${model.slug}`}>
              {model.displayName} Wraps <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
        <HomeDiscoverySection title="Latest" href="/explore" result={newest} />
      </section>
    </main>
  );
}

function HomeDiscoverySection({
  title,
  href,
  result,
}: {
  title: string;
  href: string;
  result: DiscoveryResult;
}) {
  return (
    <section
      className="home-discovery-block"
      aria-labelledby={`${title.toLowerCase()}-title`}
    >
      <div className="home-discovery-heading">
        <h3 id={`${title.toLowerCase()}-title`}>{title}</h3>
        <Link className="text-link" href={href}>
          View all <span aria-hidden="true">→</span>
        </Link>
      </div>
      {"rankingStatus" in result && result.rankingStatus && (
        <p className="discovery-ranking-note">
          {result.rankingStatus === "FALLBACK_NEWEST"
            ? "Trending is temporarily using Newest"
            : `Ranking ${result.rankingStatus.toLowerCase()}`}
          {result.calculatedAt ? ` · calculated ${result.calculatedAt}` : ""}
        </p>
      )}
      {result.status === "ok" ? (
        <DiscoveryGrid wraps={result.wraps} />
      ) : (
        <DiscoveryState state={result.status} label={`${title} Discovery`} />
      )}
    </section>
  );
}
