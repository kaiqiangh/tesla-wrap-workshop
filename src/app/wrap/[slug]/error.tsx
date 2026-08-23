"use client";

import { BoundaryExploreLink } from "../../boundary-panel";
import {
  RouteErrorBoundary,
  type RouteErrorProps,
} from "../../route-error-boundary";

export default function WrapRouteError(props: RouteErrorProps) {
  return (
    <RouteErrorBoundary
      {...props}
      title="This Wrap is temporarily unavailable."
      body="We could not load this Wrap safely just now. Retry in a moment, or pick another Wrap while you wait."
      actions={<BoundaryExploreLink />}
    />
  );
}
