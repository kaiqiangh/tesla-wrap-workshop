import { SiteHeader } from "../components/site-header";

export function DiscoveryLoading() {
  return (
    <main className="discovery-shell discovery-loading" aria-busy="true">
      <SiteHeader brandHref="/" label="Discovery navigation" links={[]} />
      <section className="discovery-heading" aria-labelledby="loading-title">
        <p className="eyebrow">DISCOVERY SET</p>
        <h1 id="loading-title">Loading the gallery.</h1>
        <p>Checking the current public Discovery Set.</p>
      </section>
      <section className="discovery-results" aria-label="Loading results">
        <div className="discovery-loading-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="discovery-loading-card" key={index} />
          ))}
        </div>
      </section>
    </main>
  );
}
