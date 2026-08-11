import { expect, test } from "@playwright/test";

test("preview SEO surfaces are canonical and unavailable to crawlers", async ({
  page,
  request,
  baseURL,
}) => {
  const home = await page.goto("/");
  expect(home?.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    baseURL!,
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    /WrapForge/,
  );

  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toContain("Disallow: /");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(sitemap.headers()["x-robots-tag"]).toBe(
    "noindex, nofollow, noarchive",
  );
  expect(await sitemap.text()).toContain(`<loc>${baseURL}/</loc>`);
});
