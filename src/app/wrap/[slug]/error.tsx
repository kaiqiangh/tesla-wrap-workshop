"use client";

import { useEffect } from "react";

import { BoundaryExploreLink, BoundaryPanel } from "../../boundary-panel";

export default function WrapRouteError({
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
      title="This Wrap is temporarily unavailable."
      body="The Wrap catalog could not be loaded safely this time. Retry now; an outage is never presented as an empty catalog."
      actions={
        <>
          <button className="button" type="button" onClick={reset}>
            Retry
          </button>
          <BoundaryExploreLink />
        </>
      }
    />
  );
}
