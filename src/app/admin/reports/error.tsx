"use client";

import {
  RouteErrorBoundary,
  type RouteErrorProps,
} from "../../route-error-boundary";

export default function AdminReportsRouteError(props: RouteErrorProps) {
  return (
    <RouteErrorBoundary
      {...props}
      title="The moderation queue is temporarily unavailable."
      body="Reports could not be loaded safely this time. Retry now; nothing was lost, and the queue resumes where it left off."
    />
  );
}
