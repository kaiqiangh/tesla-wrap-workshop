"use client";

import { BoundaryHomeLink } from "./boundary-panel";
import {
  RouteErrorBoundary,
  type RouteErrorProps,
} from "./route-error-boundary";

export default function RouteError(props: RouteErrorProps) {
  return (
    <RouteErrorBoundary
      {...props}
      title="This page is temporarily unavailable."
      body="We hit an unexpected problem while loading this surface. Retry now; if it keeps failing, come back shortly."
      actions={<BoundaryHomeLink />}
    />
  );
}
