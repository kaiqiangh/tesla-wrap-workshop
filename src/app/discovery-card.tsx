import Image from "next/image";
import Link from "next/link";

import type { DiscoveryWrap } from "@/lib/discovery";

import { InteractionControls } from "./wrap/[slug]/interaction-controls";

export function DiscoveryCard({
  wrap,
  loading,
}: {
  wrap: DiscoveryWrap;
  loading: "eager" | "lazy";
}) {
  return (
    <article className="discovery-card">
      <Link className="discovery-card-media" href={`/wrap/${wrap.slug}`}>
        {wrap.preview_available ? (
          <Image
            src={`/api/wraps/${wrap.slug}/preview`}
            alt={`${wrap.title} Derived Wrap Asset`}
            width={wrap.preview_width_px}
            height={wrap.preview_height_px}
            loading={loading}
            unoptimized
          />
        ) : (
          <span className="discovery-card-unavailable">
            Preview unavailable
          </span>
        )}
      </Link>
      <div className="discovery-card-copy">
        <div className="discovery-card-heading">
          <h3>
            <Link href={`/wrap/${wrap.slug}`}>{wrap.title}</Link>
          </h3>
          {wrap.legacy && <span className="legacy-badge">Legacy</span>}
        </div>
        <p>
          {wrap.vehicle_model_name} · {wrap.template_variant_name}
        </p>
        <p>
          <Link href={`/u/${wrap.creator_username}`}>
            @{wrap.creator_username}
          </Link>
          {" · "}
          {wrap.like_count} likes · {wrap.download_count} downloads
        </p>
        {wrap.legacy && (
          <small>
            Legacy Template Variant — unavailable for new publication.
          </small>
        )}
        <InteractionControls
          slug={wrap.slug}
          initialLikeCount={wrap.like_count}
          initialFavoriteCount={wrap.favorite_count}
          initialLiked={wrap.liked}
          initialFavorited={wrap.favorited}
        />
      </div>
    </article>
  );
}

export function DiscoveryGrid({ wraps }: { wraps: DiscoveryWrap[] }) {
  return (
    <div className="discovery-grid">
      {wraps.map((wrap, index) => (
        <DiscoveryCard
          key={wrap.slug}
          wrap={wrap}
          loading={index === 0 ? "eager" : "lazy"}
        />
      ))}
    </div>
  );
}

export function DiscoveryState({
  state,
  label,
  clearHref,
}: {
  state: "empty" | "error" | "missing" | "invalid" | "rate_limited";
  label: string;
  clearHref?: string;
}) {
  const copy = {
    empty: {
      title: "Nothing published here yet.",
      body: "The Discovery Set is empty for this view. Check another model or return to the Homepage.",
    },
    error: {
      title: "Discovery is temporarily unavailable.",
      body: "The catalog could not be loaded safely. Retry shortly; an outage is never presented as an empty catalog.",
    },
    missing: {
      title: "Vehicle Model unavailable.",
      body: "That model is not part of the active official catalog.",
    },
    invalid: {
      title: "Check the Discovery filters.",
      body: "That search URL is not valid. Clear the filters and try again.",
    },
    rate_limited: {
      title: "Search is temporarily limited.",
      body: "This Guest Session has reached its short search budget. Retry shortly.",
    },
  }[state];

  return (
    <section
      className="discovery-state"
      aria-labelledby="discovery-state-title"
    >
      <p className="eyebrow">{label}</p>
      <h2 id="discovery-state-title">{copy.title}</h2>
      <p>{copy.body}</p>
      <Link className="text-link" href={clearHref ?? "/"}>
        {clearHref ? "Clear filters" : "Return to Homepage"}
      </Link>
    </section>
  );
}
