import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
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
