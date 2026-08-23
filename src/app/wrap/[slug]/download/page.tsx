import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import { SiteHeader } from "../../../../components/site-header";
import { DownloadAction } from "./download-action";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { robots: { index: false, follow: false } };
}

export default async function WrapDownloadPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_wrap", {
    p_slug: slug,
  });
  const wrap = data?.[0];
  if (error || !wrap) notFound();

  return (
    <main className="download-shell">
      <SiteHeader
        brandHref={`/wrap/${wrap.slug}`}
        label="Download navigation"
        links={[
          { href: `/wrap/${wrap.slug}`, label: "Back to Wrap", external: true },
        ]}
      />
      <article className="download-card" aria-labelledby="download-title">
        <p className="eyebrow">PRIVATE ORIGINAL DELIVERY</p>
        <h1 id="download-title">Download {wrap.title}</h1>
        <p className="download-compatibility">
          Exact Template Variant: <strong>{wrap.template_variant_name}</strong>{" "}
          · {wrap.width_px}×{wrap.height_px}
        </p>
        <p>{wrap.availability_caveat}</p>
        <p>
          The link is private and expires after 60 seconds. The gallery preview
          is never used as the Original Wrap Asset.
        </p>
        <DownloadAction slug={wrap.slug} />
        <section
          className="download-guidance"
          aria-labelledby="tesla-steps-title"
        >
          <h2 id="tesla-steps-title">Apply it in the Tesla App</h2>
          <ol>
            <li>Use Tesla App 4.59.0 or newer.</li>
            <li>
              Save the PNG where the phone can select it, then open Creations →
              Wrap → Upload.
            </li>
            <li>
              In the vehicle, open Toybox → Paint Shop → Wraps and apply the
              matching variant.
            </li>
          </ol>
          <p>
            USB fallback: format the drive as exFAT, FAT32, MS-DOS FAT, ext3, or
            ext4 (NTFS is unsupported). Put the PNG files in a root-level
            <code>Wraps</code> folder, avoid map or firmware update files, then
            use Toybox → Paint Shop → Wraps. Vehicle, software, account, and
            region availability can vary.
          </p>
          <small>
            Workflow checked against Tesla&apos;s official custom-wraps
            instructions (app v4.59.0+).
          </small>
        </section>
      </article>
    </main>
  );
}
