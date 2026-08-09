import Image from "next/image";

import { getCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

function Brand() {
  return (
    <a className="brand" href="#top" aria-label="WrapForge home">
      <span className="brand-mark" aria-hidden="true">
        W
      </span>
      <span>WRAPFORGE</span>
    </a>
  );
}

export default async function Home() {
  const models = await getCatalog();
  const variantCount = models.reduce(
    (total, model) => total + model.variants.length,
    0,
  );

  return (
    <main id="top">
      <header className="site-header">
        <Brand />
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#catalog">Models</a>
          <a href="#empty-gallery">Explore</a>
          <a className="button button-small" href="#catalog">
            Choose a Template
          </a>
        </nav>
        <details className="mobile-nav">
          <summary aria-label="Open navigation">Menu</summary>
          <div>
            <a href="#catalog">Models</a>
            <a href="#empty-gallery">Explore</a>
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
            <a className="text-link" href="#empty-gallery">
              Explore the Gallery <span aria-hidden="true">→</span>
            </a>
          </div>
          <p className="availability">
            <span aria-hidden="true">●</span> {models.length} vehicle models ·{" "}
            {variantCount} exact template variants available
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
                <h3>{model.displayName}</h3>
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
        className="empty-gallery"
        id="empty-gallery"
        aria-labelledby="gallery-title"
      >
        <p className="eyebrow">COMMUNITY GALLERY</p>
        <h2 id="gallery-title">The first gallery is waiting.</h2>
        <p>
          No published wraps yet. Start with the official catalog above; creator
          uploads arrive in the next workshop stage.
        </p>
        <a className="text-link" href="#catalog">
          Browse templates <span aria-hidden="true">↑</span>
        </a>
      </section>
    </main>
  );
}
