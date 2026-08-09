"use client";

import { useState } from "react";
import Link from "next/link";

import type { CatalogModel } from "@/lib/catalog";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { preflightUpload, type UploadProblem } from "@/lib/upload/preflight";
import { validateWrapMetadata, type LicenseType } from "@/lib/wraps/metadata";

import { signOut } from "../auth/actions";

type Props = { catalog: CatalogModel[]; username: string };
type Status = "idle" | "preflight" | "uploading" | "validating" | "ready";
type PublicError = Pick<UploadProblem, "rule" | "nextAction"> & {
  code: string;
  problem: string;
};

export function UploadStudio({ catalog, username }: Props) {
  const [variantId, setVariantId] = useState("");
  const [asserted, setAsserted] = useState(false);
  const [distributionAsserted, setDistributionAsserted] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<PublicError>();
  const [pendingId, setPendingId] = useState<string>();
  const [revision, setRevision] = useState<{
    id: string;
    dimensions: string;
    byteSize?: number;
    sha256?: string;
    previewUrl: string;
  }>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [licenseType, setLicenseType] = useState<LicenseType>(
    "PERSONAL_USE_ALLOWED",
  );
  const [tags, setTags] = useState("");
  const [publishedWrap, setPublishedWrap] = useState<{
    slug: string;
    status: string;
  }>();
  const variant = catalog
    .flatMap((model) => model.variants)
    .find((candidate) => candidate.id === variantId);

  async function chooseFile(file?: File) {
    setError(undefined);
    setRevision(undefined);
    setPublishedWrap(undefined);
    if (!file || !variant || !asserted) {
      setError({
        code: "WF-UPLOAD-REQUEST",
        problem: "Selection incomplete",
        rule: "Choose an Active Template Variant and confirm that its official template was used.",
        nextAction: "Complete Select Vehicle before choosing the PNG.",
      });
      return;
    }
    setStatus("preflight");
    try {
      if (file.size > variant.maxBytes) {
        setStatus("idle");
        setError({
          code: "WF-UPLOAD-SIZE",
          problem: `${file.size} bytes`,
          rule: `The file must be at most ${variant.maxBytes} bytes.`,
          nextAction: "Reduce the lossless PNG size and try a fresh upload.",
        });
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const checked = preflightUpload(
        { name: file.name, type: file.type, size: file.size, bytes },
        {
          width: variant.width,
          height: variant.height,
          maxBytes: variant.maxBytes,
        },
      );
      if (!checked.ok) {
        setStatus("idle");
        setError({ ...checked, problem: checked.measured });
        return;
      }

      const started = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateVariantId: variant.id,
          filename: file.name,
          mimeType: file.type,
          templateAsserted: asserted,
        }),
      });
      const startBody = (await started.json()) as {
        id?: string;
        staging_key?: string;
        error?: PublicError;
      };
      if (!started.ok || !startBody.id || !startBody.staging_key) {
        setStatus("idle");
        setError(startBody.error ?? fallback());
        return;
      }
      setPendingId(startBody.id);

      setStatus("uploading");
      const transfer = await createBrowserSupabaseClient()
        .storage.from("wrap-staging")
        .upload(startBody.staging_key, file, {
          contentType: "image/png",
          upsert: false,
        });
      if (transfer.error) {
        const abandoned = await fetch(`/api/uploads/${startBody.id}`, {
          method: "DELETE",
        });
        if (abandoned.ok) setPendingId(undefined);
        setStatus("idle");
        setError({
          code: abandoned.ok ? "WF-UPLOAD-TRANSFER" : "WF-UPLOAD-ABANDON",
          problem: abandoned.ok
            ? "The private transfer did not complete."
            : "The failed transfer could not be released.",
          rule: abandoned.ok
            ? "The PNG must upload once under the server-issued owner key."
            : "A failed transfer must become terminal before a fresh retry.",
          nextAction: abandoned.ok
            ? "Choose the file again to start a fresh upload."
            : "Reload the studio and retry releasing this upload.",
        });
        return;
      }

      await finalizePending(startBody.id, variant);
    } catch {
      setStatus("idle");
      setError(fallback());
    }
  }

  async function finalizePending(
    id: string,
    selectedVariant: NonNullable<typeof variant>,
  ) {
    setStatus("validating");
    try {
      const finalized = await fetch(`/api/uploads/${id}/finalize`, {
        method: "POST",
      });
      const finalBody = (await finalized.json()) as {
        state?: string;
        assetRevisionId?: string;
        width?: number;
        height?: number;
        byteSize?: number;
        sha256?: string;
        error?: PublicError;
      };
      if (
        !finalized.ok ||
        finalBody.state !== "READY" ||
        !finalBody.assetRevisionId
      ) {
        setStatus("idle");
        setError(finalBody.error ?? fallback());
        return;
      }
      setPendingId(undefined);
      setStatus("ready");
      setRevision({
        id: finalBody.assetRevisionId,
        dimensions: `${finalBody.width ?? selectedVariant.width}×${finalBody.height ?? selectedVariant.height}`,
        byteSize: finalBody.byteSize,
        sha256: finalBody.sha256,
        previewUrl: `/api/uploads/${id}/preview`,
      });
    } catch {
      setStatus("idle");
      setError(fallback());
    }
  }

  async function publish() {
    if (!revision || !variant) return;
    const metadata = validateWrapMetadata({
      title,
      description,
      licenseType,
      tags: tags.split(","),
      templateAsserted: asserted,
      distributionAsserted,
    });
    if (!metadata.ok) {
      setError({
        code: metadata.problem.code,
        problem: metadata.problem.measured,
        rule: "Publication metadata must be bounded, canonical, and separately asserted.",
        nextAction: metadata.problem.nextAction,
      });
      return;
    }
    setStatus("validating");
    try {
      const response = await fetch("/api/wraps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetRevisionId: revision.id,
          description: metadata.value.description,
          distributionAsserted: metadata.value.distributionAsserted,
          licenseType: metadata.value.licenseType,
          tags: metadata.value.tags,
          templateAsserted: metadata.value.templateAsserted,
          templateVariantId: variant.id,
          title: metadata.value.title,
        }),
      });
      const body = (await response.json()) as {
        wrap?: { slug: string; status: string };
        error?: PublicError;
      };
      if (!response.ok || !body.wrap) {
        setStatus("ready");
        setError(body.error ?? fallback());
        return;
      }
      setPublishedWrap(body.wrap);
      setStatus("ready");
      setError(undefined);
    } catch {
      setStatus("ready");
      setError(fallback());
    }
  }

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div>
          <p className="eyebrow">UPLOAD STUDIO · @{username}</p>
          <h1>Build a Template-verified Wrap Asset.</h1>
          <div className="studio-account-actions">
            <Link className="text-link" href={`/u/${username}`}>
              View Profile
            </Link>
            <form action={signOut}>
              <button className="text-button" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <ol className="step-rail" aria-label="Upload workflow">
          <li aria-current={!variant ? "step" : undefined}>
            <span>1</span>Select Vehicle
          </li>
          <li
            className={variant ? "current" : ""}
            aria-current={variant ? "step" : undefined}
          >
            <span>2</span>Upload File
          </li>
          <li>
            <span>3</span>Add Details
          </li>
          <li>
            <span>4</span>Preview &amp; Publish
          </li>
        </ol>
      </header>

      <div className="studio-grid">
        <section className="studio-main" aria-labelledby="vehicle-step">
          <p className="eyebrow">STEP 01</p>
          <h2 id="vehicle-step">Select Vehicle</h2>
          <p className="studio-intro">
            Choose the exact Active revision used to create the artwork. Vehicle
            Model alone is not a compatibility claim.
          </p>
          {catalog.map((model) => (
            <fieldset className="variant-group" key={model.id}>
              <legend>{model.displayName}</legend>
              <div className="variant-grid">
                {model.variants.map((item) => (
                  <div
                    className={
                      variantId === item.id
                        ? "variant-card selected"
                        : "variant-card"
                    }
                    key={item.id}
                  >
                    <input
                      id={`variant-${item.id}`}
                      type="radio"
                      name="template-variant"
                      value={item.id}
                      checked={variantId === item.id}
                      disabled={status !== "idle"}
                      onChange={() => {
                        setVariantId(item.id);
                        setAsserted(false);
                        setDistributionAsserted(false);
                        setError(undefined);
                        setRevision(undefined);
                        setPublishedWrap(undefined);
                      }}
                    />
                    <label htmlFor={`variant-${item.id}`}>
                      <strong>{item.displayName}</strong>
                      <span>
                        {item.dimensions} · {item.state}
                      </span>
                      <small>Verified {item.verifiedAt}</small>
                    </label>
                    <a
                      className="source-link"
                      href={item.sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Official Tesla template source
                    </a>
                  </div>
                ))}
              </div>
            </fieldset>
          ))}

          <section className="upload-step" aria-labelledby="upload-step">
            <p className="eyebrow">STEP 02</p>
            <h2 id="upload-step">Upload File</h2>
            <p className="studio-intro">
              Browser preflight checks obvious problems before transfer. Only
              authoritative Node server validation can create a READY Asset
              Revision.
            </p>
            <label className="assertion">
              <input
                type="checkbox"
                checked={asserted}
                disabled={!variant || status !== "idle"}
                onChange={(event) => setAsserted(event.target.checked)}
              />
              I used the selected matching official Tesla template.
            </label>
            <label
              className={
                variant &&
                asserted &&
                !pendingId &&
                (status === "idle" || status === "ready")
                  ? "file-picker"
                  : "file-picker disabled"
              }
            >
              <span>{statusLabel(status)}</span>
              <input
                type="file"
                accept="image/png,.png"
                disabled={
                  !variant ||
                  !asserted ||
                  Boolean(pendingId) ||
                  (status !== "idle" && status !== "ready")
                }
                onChange={(event) => void chooseFile(event.target.files?.[0])}
              />
              <small>
                PNG · exact dimensions · no more than 1,000,000 bytes
              </small>
            </label>
            {error && (
              <div className="upload-error" role="alert">
                <strong>{error.problem}</strong>
                <p>{error.rule}</p>
                <p>{error.nextAction}</p>
                <code>{error.code}</code>
                {pendingId &&
                  variant &&
                  [
                    "WF-UPLOAD-BUSY",
                    "WF-UPLOAD-DATABASE-UNKNOWN",
                    "WF-UPLOAD-UNAVAILABLE",
                  ].includes(error.code) && (
                    <button
                      className="button"
                      type="button"
                      onClick={() => void finalizePending(pendingId, variant)}
                      disabled={status === "validating"}
                    >
                      Retry this finalization
                    </button>
                  )}
              </div>
            )}
            {revision && (
              <div className="ready-result" role="status">
                <p className="eyebrow">READY ASSET REVISION</p>
                <strong>{revision.dimensions} normalized PNG</strong>
                {revision.byteSize && (
                  <span>{revision.byteSize.toLocaleString()} bytes</span>
                )}
                {revision.sha256 && <code>SHA-256 {revision.sha256}</code>}
                <p>
                  The Original, private preview, and private thumbnail are
                  complete. Add the bounded metadata before publication.
                </p>
              </div>
            )}
          </section>

          {revision && variant && (
            <section className="publish-step" aria-labelledby="details-step">
              <p className="eyebrow">STEP 03</p>
              <h2 id="details-step">Add Details</h2>
              <p className="studio-intro">
                These fields describe the Wrap; they never mutate the immutable
                Asset Revision.
              </p>
              <div className="form-grid">
                <label>
                  Title
                  <input
                    aria-label="Wrap title"
                    maxLength={80}
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    aria-label="Wrap description"
                    maxLength={2000}
                    required
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <label>
                  License
                  <select
                    aria-label="Wrap license"
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
                    aria-label="Wrap tags"
                    placeholder="night-drive, graphite"
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                  />
                  <small>Comma-separated, up to ten canonical Tags.</small>
                </label>
                <label className="assertion">
                  <input
                    type="checkbox"
                    checked={distributionAsserted}
                    onChange={(event) =>
                      setDistributionAsserted(event.target.checked)
                    }
                  />
                  I own this artwork or have permission to distribute it.
                </label>
              </div>
            </section>
          )}

          {revision && variant && (
            <section className="publish-step" aria-labelledby="publish-step">
              <p className="eyebrow">STEP 04</p>
              <h2 id="publish-step">Preview &amp; Publish</h2>
              <div className="publish-preview">
                {/* eslint-disable-next-line @next/next/no-img-element -- private preview route requires the browser session cookie */}
                <img
                  src={revision.previewUrl}
                  alt="Derived Wrap Asset preview"
                  width={Math.min(variant.width, 640)}
                  height={Math.min(variant.height, 640)}
                />
                <div>
                  <strong>{title.trim() || "Untitled Wrap"}</strong>
                  <p>
                    Compatible with {variant.displayName} ·{" "}
                    {revision.dimensions}
                  </p>
                  <p>{variant.verifiedAt} catalog verification · Active</p>
                  <p>
                    Availability can vary by vehicle, configuration, account,
                    software, and region.
                  </p>
                </div>
              </div>
              <ol
                className="readiness-gates"
                aria-label="Publication readiness"
              >
                <li className="gate-ready">Active Profile</li>
                <li className="gate-ready">Active Template Variant</li>
                <li className="gate-ready">Template-verified Asset Revision</li>
                <li
                  className={
                    title.trim() && description.trim() ? "gate-ready" : ""
                  }
                >
                  Required metadata and license
                </li>
                <li className={distributionAsserted ? "gate-ready" : ""}>
                  Template and distribution assertions
                </li>
              </ol>
              <button
                className="button"
                type="button"
                onClick={() => void publish()}
                disabled={status === "validating" || Boolean(publishedWrap)}
              >
                {publishedWrap ? "Published" : "Publish Wrap"}
              </button>
              {publishedWrap && (
                <div className="ready-result" role="status">
                  <strong>Published Wrap is ready.</strong>
                  <p>
                    <Link href={`/wrap/${publishedWrap.slug}`}>
                      View Wrap detail
                    </Link>
                    {" · "}
                    <Link href={`/wrap/${publishedWrap.slug}/edit`}>
                      Manage Wrap
                    </Link>
                  </p>
                </div>
              )}
            </section>
          )}
        </section>

        <aside className="studio-summary" aria-label="Upload summary">
          <p className="eyebrow">UPLOAD SUMMARY</p>
          <h2>{variant?.displayName ?? "No variant selected"}</h2>
          <dl>
            <div>
              <dt>Template</dt>
              <dd>{variant?.key ?? "—"}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{variant?.dimensions ?? "—"}</dd>
            </div>
            <div>
              <dt>Catalog state</dt>
              <dd>{variant?.state ?? "—"}</dd>
            </div>
            <div>
              <dt>Server status</dt>
              <dd>
                {revision
                  ? "READY"
                  : status === "idle"
                    ? "Not started"
                    : status.toUpperCase()}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}

function statusLabel(status: Status) {
  if (status === "preflight") return "Checking PNG…";
  if (status === "uploading") return "Uploading privately…";
  if (status === "validating") return "Authoritative validation…";
  if (status === "ready") return "Choose another PNG";
  return "Choose PNG";
}

function fallback(): PublicError {
  return {
    code: "WF-UPLOAD-UNAVAILABLE",
    problem: "The upload could not be completed.",
    rule: "A Pending Upload must pass every private transfer and validation gate.",
    nextAction: "Start a fresh upload after the service recovers.",
  };
}
