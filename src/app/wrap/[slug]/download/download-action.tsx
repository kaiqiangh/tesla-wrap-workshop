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
      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { problem?: string; nextAction?: string };
        };
        throw new Error(
          body.error?.nextAction || body.error?.problem || "Download failed.",
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        response.headers.get("x-download-filename") || `${slug}.png`;
      document.body.append(anchor);
      anchor.click();
      window.setTimeout(() => {
        anchor.remove();
        URL.revokeObjectURL(url);
      }, 0);
      setMessage("Original Wrap download started.");
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
