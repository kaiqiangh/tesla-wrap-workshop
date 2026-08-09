"use client";

import { useState } from "react";

export function DownloadAction({ slug }: { slug: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/wraps/${slug}/download`, {
        method: "POST",
        cache: "no-store",
      });
      const body = (await response.json()) as {
        downloadUrl?: string;
        expiresAt?: string;
        error?: { problem?: string; nextAction?: string };
      };
      if (!response.ok || !body.downloadUrl) {
        throw new Error(
          body.error?.nextAction || body.error?.problem || "Download failed.",
        );
      }
      window.location.assign(body.downloadUrl);
      setMessage(
        `Download link ready until ${new Date(body.expiresAt ?? "").toLocaleTimeString()}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Download failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url });
        setMessage("Confirmation link shared.");
      } else {
        await navigator.clipboard.writeText(url);
        setMessage("Confirmation link copied.");
      }
    } catch {
      setMessage("Sharing was cancelled. Copy the page URL to share it.");
    }
  }

  return (
    <div className="download-actions">
      <button
        className="button"
        type="button"
        onClick={download}
        disabled={busy}
      >
        {busy ? "Preparing private link…" : "Download Original Wrap"}
      </button>
      <button className="text-button" type="button" onClick={share}>
        Share confirmation
      </button>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
