import type { MetadataRoute } from "next";

import { readPublicEnvironment } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = new URL(
    readPublicEnvironment(process.env).NEXT_PUBLIC_SITE_URL,
  );
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
