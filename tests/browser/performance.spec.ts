import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const routes = [
  { path: "/explore", heading: "Explore the gallery." },
  { path: "/trending", heading: "What the community is seeing." },
  { path: "/models/cybertruck", heading: "Cybertruck Wraps" },
] as const;

test("records Discovery render performance baseline", async ({
  page,
}, testInfo) => {
  const measurements = [];

  for (const route of routes) {
    const startedAt = Date.now();
    const response = await page.goto(route.path, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: route.heading }),
    ).toBeVisible();
    const routeElapsedMs = Date.now() - startedAt;
    const timing = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const firstContentfulPaint = performance
        .getEntriesByName("first-contentful-paint")
        .at(0);
      return {
        cards: document.querySelectorAll("article.discovery-card").length,
        firstContentfulPaintMs: firstContentfulPaint?.startTime ?? null,
        loadEventEndMs: navigation?.loadEventEnd ?? null,
        responseEndMs: navigation?.responseEnd ?? null,
        transferSize: navigation?.transferSize ?? null,
        encodedBodySize: navigation?.encodedBodySize ?? null,
        serverTiming: navigation?.serverTiming.map((entry) => ({
          description: entry.description,
          duration: entry.duration,
          name: entry.name,
        })),
      };
    });
    measurements.push({
      ...timing,
      path: route.path,
      routeElapsedMs,
      status: response?.status() ?? null,
    });
  }

  const projectName = testInfo.project.name.replace(/[^a-z0-9_-]/gi, "-");
  const outputDirectory =
    process.env.PERFORMANCE_OUTPUT_DIR ?? testInfo.outputDir;
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, `${projectName}-discovery-render.json`),
    `${JSON.stringify({ project: projectName, measurements }, null, 2)}\n`,
  );
});
