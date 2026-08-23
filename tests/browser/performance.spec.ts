import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const routes = [
  { path: "/explore", heading: "Explore the gallery." },
  { path: "/trending", heading: "What the community is seeing." },
  { path: "/models/cybertruck", heading: "Cybertruck Wraps" },
] as const;
const loadConcurrency = 16;

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ];
}

test("records Discovery render and bounded load profile", async ({
  page,
}, testInfo) => {
  const measurements = [];
  const load = [];

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

    const concurrent = await Promise.all(
      Array.from({ length: loadConcurrency }, async () => {
        const requestStartedAt = Date.now();
        const request = await page.request.get(route.path);
        const body = await request.body();
        expect(request.status()).toBe(200);
        return {
          bytes: body.byteLength,
          elapsedMs: Date.now() - requestStartedAt,
          status: request.status(),
        };
      }),
    );
    const elapsed = concurrent.map((request) => request.elapsedMs);
    load.push({
      completed: concurrent.filter((request) => request.status === 200).length,
      concurrency: loadConcurrency,
      maxMs: Math.max(...elapsed),
      p50Ms: percentile(elapsed, 0.5),
      p95Ms: percentile(elapsed, 0.95),
      path: route.path,
      totalBytes: concurrent.reduce((sum, request) => sum + request.bytes, 0),
    });
  }

  const projectName = testInfo.project.name.replace(/[^a-z0-9_-]/gi, "-");
  const outputDirectory =
    process.env.PERFORMANCE_OUTPUT_DIR ?? testInfo.outputDir;
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, `${projectName}-discovery-render.json`),
    `${JSON.stringify({ load, measurements, project: projectName }, null, 2)}\n`,
  );
});
