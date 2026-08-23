"use client";

import { useEffect, type ReactNode } from "react";

import { BoundaryPanel } from "./boundary-panel";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export function RouteErrorBoundary({
  error,
  reset,
  title,
  body,
  actions,
}: RouteErrorProps & { title: string; body: string; actions?: ReactNode }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <BoundaryPanel
      eyebrow="Unexpected problem"
      title={title}
      body={body}
      actions={
        <>
          <button className="button" type="button" onClick={reset}>
            Retry
          </button>
          {actions}
        </>
      }
    />
  );
}
