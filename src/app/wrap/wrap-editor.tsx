"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { LicenseType } from "@/lib/wraps/metadata";

export type EditableWrap = {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: string;
  creator_username: string;
  template_variant_name: string;
  template_variant_key: string;
  width_px: number;
  height_px: number;
  verified_at: string;
  license_type: string;
  template_asserted: boolean;
  distribution_asserted: boolean;
  tags: string[];
  first_published_at: string;
  asset_revision_id: string;
};

export function WrapEditor({
  username,
  wrap,
}: {
  username: string;
  wrap: EditableWrap;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(wrap.title);
  const [description, setDescription] = useState(wrap.description);
  const [licenseType, setLicenseType] = useState<LicenseType>(
    wrap.license_type as LicenseType,
  );
  const [tags, setTags] = useState(wrap.tags.join(", "));
  const [status, setStatus] = useState(wrap.status);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/wraps/${wrap.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          licenseType,
          tags: tags.split(","),
        }),
      });
      const body = (await response.json()) as { error?: { problem?: string } };
      if (!response.ok) {
        setError(body.error?.problem ?? "The Wrap could not be saved.");
        return;
      }
      router.refresh();
    } catch {
      setError("The Wrap could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(action: "unpublish" | "republish") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/wraps/${wrap.slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json()) as {
        wrap?: { status: string };
        error?: { problem?: string };
      };
      if (!response.ok || !body.wrap) {
        setError(body.error?.problem ?? "The Wrap state could not be changed.");
        return;
      }
      setStatus(body.wrap.status);
      router.refresh();
    } catch {
      setError("The Wrap state could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove this Wrap from normal product views?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/wraps/${wrap.slug}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as { error?: { problem?: string } };
      if (!response.ok) {
        setError(body.error?.problem ?? "The Wrap could not be removed.");
        return;
      }
      router.push(`/u/${username}`);
    } catch {
      setError("The Wrap could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div>
          <p className="eyebrow">WRAP MANAGEMENT · @{username}</p>
          <h1>Edit and manage your Wrap.</h1>
          <p className="studio-intro">
            The Asset Revision and public identity remain immutable while
            bounded metadata and visibility state change through fresh server
            checks.
          </p>
        </div>
        <Link className="text-link" href={`/wrap/${wrap.slug}`}>
          View public detail
        </Link>
      </header>
      <section className="studio-grid">
        <div className="studio-main">
          <p className="eyebrow">{status}</p>
          <h2>{wrap.template_variant_name}</h2>
          <p className="studio-intro">
            {wrap.width_px}×{wrap.height_px} · Verified {wrap.verified_at} ·
            Asset Revision {wrap.asset_revision_id}
          </p>
          <div className="form-grid">
            <label>
              Title
              <input
                maxLength={80}
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={2000}
                required
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              License
              <select
                value={licenseType}
                onChange={(event) =>
                  setLicenseType(event.target.value as LicenseType)
                }
              >
                <option value="PERSONAL_USE_ALLOWED">
                  Personal Use Allowed
                </option>
                <option value="CREATIVE_COMMONS">Creative Commons</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label>
              Tags
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
              />
            </label>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="hero-actions">
            <button
              className="button"
              type="button"
              onClick={() => void save()}
              disabled={busy || status === "REMOVED"}
            >
              Save metadata
            </button>
            {status === "PUBLISHED" ? (
              <button
                className="text-button"
                type="button"
                onClick={() => void transition("unpublish")}
                disabled={busy}
              >
                Unpublish
              </button>
            ) : status === "UNPUBLISHED" ? (
              <button
                className="text-button"
                type="button"
                onClick={() => void transition("republish")}
                disabled={busy}
              >
                Republish
              </button>
            ) : null}
            {status !== "REMOVED" && (
              <Link
                className="text-button"
                href={`/upload?replace=${wrap.slug}`}
              >
                Replace Asset Revision
              </Link>
            )}
            {status !== "REMOVED" && (
              <button
                className="text-button danger-text"
                type="button"
                onClick={() => void remove()}
                disabled={busy}
              >
                Remove Wrap
              </button>
            )}
          </div>
        </div>
        <aside className="studio-summary">
          <p className="eyebrow">PUBLIC IDENTITY</p>
          <h2>{wrap.slug}</h2>
          <dl>
            <div>
              <dt>First Published</dt>
              <dd>
                {new Date(wrap.first_published_at).toLocaleDateString("en-IE")}
              </dd>
            </div>
            <div>
              <dt>Template assertion</dt>
              <dd>{wrap.template_asserted ? "Confirmed" : "Missing"}</dd>
            </div>
            <div>
              <dt>Distribution rights</dt>
              <dd>{wrap.distribution_asserted ? "Confirmed" : "Missing"}</dd>
            </div>
            <div>
              <dt>Asset Revision</dt>
              <dd>Immutable</dd>
            </div>
          </dl>
        </aside>
      </section>
    </main>
  );
}
