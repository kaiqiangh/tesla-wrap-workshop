import type { MetadataRoute } from "next";

import { readPublicEnvironment } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const environment = readPublicEnvironment(process.env);
  const siteUrl = new URL(environment.NEXT_PUBLIC_SITE_URL);
  if (environment.WRAPFORGE_ENVIRONMENT !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin/",
        "/auth/",
        "/favorites",
        "/onboarding",
        "/settings/",
        "/sign-in",
        "/upload",
        "/wrap/*/download",
        "/wrap/*/edit",
      ],
    },
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
  };
}
