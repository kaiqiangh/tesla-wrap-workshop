import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { Brand } from "../../brand";
import { InteractionControls } from "./interaction-controls";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_wrap", {
    p_slug: slug,
  });
  const wrap = data?.[0];
  if (error || !wrap) {
    return {
      title: "Wrap unavailable | WrapForge",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: `${wrap.title} | WrapForge`,
    description: `${wrap.title} for ${wrap.template_variant_name} by @${wrap.creator_username}.`,
    alternates: { canonical: `/wrap/${wrap.slug}` },
    openGraph: {
      title: `${wrap.title} | WrapForge`,
      description: `Template-verified Custom Wrap for ${wrap.template_variant_name}.`,
      type: "article",
      url: `/wrap/${wrap.slug}`,
      images: [{ url: `/api/wraps/${wrap.slug}/preview` }],
    },
  };
}

export default async function WrapDetailPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_wrap", {
    p_slug: slug,
  });
  if (error) throw new Error("Wrap is temporarily unavailable");
  const wrap = data?.[0];
  if (!wrap) notFound();
  const access = await readProfileAccess(supabase);
  const canManage =
    access.status === "active" && access.username === wrap.creator_username;
  const license =
    {
      PERSONAL_USE_ALLOWED: "Personal Use Allowed",
      CREATIVE_COMMONS: "Creative Commons",
      OTHER: "Other",
    }[wrap.license_type] ?? wrap.license_type;

  return (
    <main className="wrap-detail-shell">
      <header className="site-header">
        <Brand href="/" />
        <nav className="desktop-nav" aria-label="Wrap navigation">
          <Link href="/">Explore</Link>
          <Link href="/upload">Upload a Wrap</Link>
        </nav>
      </header>
      <article className="wrap-detail" aria-labelledby="wrap-title">
        <div className="wrap-detail-preview">
          {wrap.preview_available ? (
            <Image
              src={`/api/wraps/${wrap.slug}/preview`}
              alt={`${wrap.title} Derived Wrap Asset`}
              width={wrap.preview_width_px ?? 640}
              height={wrap.preview_height_px ?? 640}
              priority
            />
          ) : (
            <div className="wrap-preview-unavailable">Preview unavailable</div>
          )}
        </div>
        <div className="wrap-detail-copy">
          <p className="eyebrow">PUBLISHED WRAP</p>
          <h1 id="wrap-title">{wrap.title}</h1>
          <p className="wrap-creator">
            by{" "}
            <Link href={`/u/${wrap.creator_username}`}>
              @{wrap.creator_username}
            </Link>
            {" · "}
            {wrap.creator_display_name}
          </p>
          <p className="wrap-description">{wrap.description}</p>
          <section
            className="compatibility-claim"
            aria-labelledby="compatibility-title"
          >
            <p className="eyebrow" id="compatibility-title">
              COMPATIBILITY CLAIM
            </p>
            <strong>
              {wrap.vehicle_model_name} — {wrap.template_variant_name}
            </strong>
            <span>
              {wrap.width_px}×{wrap.height_px} · Verified {wrap.verified_at}
            </span>
            {wrap.legacy && (
              <b>Legacy Template Variant — unavailable for new publication.</b>
            )}
            <p>{wrap.availability_caveat}</p>
          </section>
          <div className="wrap-actions">
            <Link className="button" href={`/wrap/${wrap.slug}/download`}>
              Download Wrap
            </Link>
            {canManage && (
              <Link className="text-link" href={`/wrap/${wrap.slug}/edit`}>
                Manage Wrap
              </Link>
            )}
          </div>
          <InteractionControls
            slug={wrap.slug}
            initialLikeCount={wrap.like_count}
            initialFavoriteCount={wrap.favorite_count}
          />
          <p className="download-coming-soon">
            Download confirmation shows the exact Template Variant and current
            Tesla App/USB import guidance before issuing a short-lived private
            link.
          </p>
          <dl className="wrap-stats" aria-label="Wrap counts">
            <div>
              <dt>Downloads</dt>
              <dd>{wrap.download_count}</dd>
            </div>
            <div>
              <dt>Likes</dt>
              <dd>{wrap.like_count}</dd>
            </div>
            <div>
              <dt>Favorites</dt>
              <dd>{wrap.favorite_count}</dd>
            </div>
            <div>
              <dt>Comments</dt>
              <dd>{wrap.comment_count}</dd>
            </div>
          </dl>
          <div className="wrap-tags" aria-label="Tags">
            {wrap.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
          <p className="wrap-license">License: {license}</p>
          <p className="wrap-published-date">
            First Published{" "}
            {new Date(wrap.first_published_at).toLocaleDateString("en-IE")}
          </p>
        </div>
      </article>
    </main>
  );
}
