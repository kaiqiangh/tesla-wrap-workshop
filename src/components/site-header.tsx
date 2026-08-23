import Link from "next/link";

import { Brand } from "../app/brand";

export type SiteHeaderLink = {
  href: string;
  label: string;
  className?: string;
  /** Render as a plain anchor (full reload) instead of next/link. */
  external?: boolean;
};

// Shared site header (UI-03/UI-16): one skeleton -- Brand, desktop nav,
// optional mobile details -- parameterized per page. Purely structural:
// rendered classes and aria-labels match the hand-copied markup it
// replaces.
export function SiteHeader({
  brandHref = "/",
  label,
  links,
  mobile,
}: {
  brandHref?: string;
  label: string;
  links: SiteHeaderLink[];
  mobile?: boolean;
}) {
  return (
    <header className="site-header">
      <Brand href={brandHref} />
      {links.length > 0 ? (
        <nav className="desktop-nav" aria-label={label}>
          {links.map((link) =>
            link.className || link.external ? (
              <a key={link.href} className={link.className} href={link.href}>
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ),
          )}
        </nav>
      ) : null}
      {mobile ? (
        <details className="mobile-nav">
          <summary aria-label="Open navigation">Menu</summary>
          <div>
            {links.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </div>
        </details>
      ) : null}
    </header>
  );
}
