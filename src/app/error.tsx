"use client";

import { useEffect } from "react";

import { BoundaryHomeLink, BoundaryPanel } from "./boundary-panel";

export default function RouteError({
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
      title="This page is temporarily unavailable."
      body="We hit an unexpected problem while loading this surface. Retry now; if it keeps failing, come back shortly."
      actions={
        <>
          <button className="button" type="button" onClick={reset}>
            Retry
          </button>
          <BoundaryHomeLink />
        </>
      }
    />
  );
}
