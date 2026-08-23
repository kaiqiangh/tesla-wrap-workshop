import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RouteError from "./error";
import GlobalRouteError from "./global-error";
import NotFound from "./not-found";
import AdminReportsRouteError from "./admin/reports/error";
import WrapRouteError from "./wrap/[slug]/error";

function markup(element: React.ReactElement) {
  return renderToStaticMarkup(element);
}

function errorProps() {
  return {
    error: Object.assign(new Error("database unavailable"), {
      digest: "test-digest",
    }),
    reset: vi.fn(),
  };
}

describe("branded route boundaries", () => {
  it("notFound renders the branded 404 panel with navigation", () => {
    const html = markup(createElement(NotFound));
    expect(html).toContain("Page not found.");
    expect(html).toContain("404");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/explore"');
    expect(html).toContain("Return to Homepage");
    expect(html).toContain("Explore Wraps");
  });

  it("root error boundary offers retry and a way home", () => {
    const html = markup(createElement(RouteError, errorProps()));
    expect(html).toContain("This page is temporarily unavailable.");
    expect(html).toContain("Retry</button>");
    expect(html).toContain("Return to Homepage");
  });

  it("wrap detail boundary uses wrap-specific copy", () => {
    const html = markup(createElement(WrapRouteError, errorProps()));
    expect(html).toContain("This Wrap is temporarily unavailable.");
    expect(html).toContain("Retry</button>");
    expect(html).toContain("Explore Wraps");
    expect(html).not.toContain("moderation queue");
  });

  it("admin reports boundary names the moderation queue", () => {
    const html = markup(createElement(AdminReportsRouteError, errorProps()));
    expect(html).toContain("The moderation queue is temporarily unavailable.");
    expect(html).toContain("Retry</button>");
  });

  it("global error renders a self-styled shell without stylesheet classes", () => {
    const html = markup(createElement(GlobalRouteError, errorProps()));
    expect(html).toContain("WrapForge is temporarily unavailable.");
    expect(html).toContain("Retry</button>");
    expect(html).toContain('href="/"');
    expect(html).toContain("style=");
    expect(html).not.toContain("className");
  });
});
