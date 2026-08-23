import Link from "next/link";
import type { ReactNode } from "react";

export function BoundaryPanel({
  eyebrow,
  title,
  body,
  actions,
}: {
  eyebrow: string;
  title: string;
  body: string;
  actions: ReactNode;
}) {
  return (
    <main className="boundary-shell">
      {/* Intentionally shares .discovery-state's panel shape with browse
          empty/error states so every surface speaks with one visual voice;
          the boundary scope below only constrains width. */}
      <section className="discovery-state" aria-labelledby="boundary-title">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="boundary-title">{title}</h2>
        <p>{body}</p>
        <div className="boundary-actions">{actions}</div>
      </section>
    </main>
  );
}

export function BoundaryHomeLink() {
  return (
    <Link className="text-link" href="/">
      Return to Homepage
    </Link>
  );
}

export function BoundaryExploreLink() {
  return (
    <Link className="text-link" href="/explore">
      Explore Wraps
    </Link>
  );
}
