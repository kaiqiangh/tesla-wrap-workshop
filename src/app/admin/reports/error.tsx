"use client";

import { useEffect } from "react";

import { BoundaryPanel } from "../../boundary-panel";

export default function AdminReportsRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <BoundaryPanel
      eyebrow="Unexpected problem"
      title="The moderation queue is temporarily unavailable."
      body="Reports could not be loaded safely this time. Retry now; nothing was lost, and the queue resumes where it left off."
      actions={
        <button className="button" type="button" onClick={reset}>
          Retry
        </button>
      }
    />
  );
}
