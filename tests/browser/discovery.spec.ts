import { expect, test } from "@playwright/test";

test("guest can reproduce Discovery filters and clear incompatible variants", async ({
  page,
}, testInfo) => {
  test.skip(!["desktop-1440", "mobile-chrome"].includes(testInfo.project.name));
  const originalRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/wrap-originals"))
      originalRequests.push(request.url());
  });
  await page.goto("/explore?q=not-a-real-wrap&sort=MOST_DOWNLOADED");
  await expect(
    page.getByRole("heading", { name: "Explore the gallery." }),
  ).toBeVisible();
  await expect(page.getByLabel("Search")).toHaveValue("not-a-real-wrap");
  await expect(page.getByLabel("Sort")).toHaveValue("MOST_DOWNLOADED");
  await expect(
    page.getByRole("heading", { name: "Nothing published here yet." }),
  ).toBeVisible();
  expect(originalRequests).toEqual([]);

  await page.goto("/explore?q=not-a-real-wrap&sort=MOST_DOWNLOADED");
  await expect(
    page.locator("form.discovery-filters").getByRole("link", {
      name: "Clear filters",
    }),
  ).toHaveAttribute("href", "/explore");

  await page.goto("/explore?q=back-forward&sort=MOST_DOWNLOADED");
  await page.goto("/explore?sort=NEWEST");
  await page.goBack();
  await expect(page.getByLabel("Search")).toHaveValue("back-forward");

  await page.goto("/explore?cursor=not-a-cursor");
  await expect(
    page.getByRole("heading", { name: "Check the Discovery filters." }),
  ).toBeVisible();
  await expect(
    page.locator("section.discovery-state").getByRole("link", {
      name: "Clear filters",
    }),
  ).toHaveAttribute("href", "/explore");

  await page.goto("/trending?sort=BOGUS");
  await expect(
    page.getByRole("heading", { name: "Check the Discovery filters." }),
  ).toBeVisible();

  await page.goto("/explore?q=not-a-real-wrap&sort=MOST_DOWNLOADED");
  await page.getByLabel("Vehicle Model").selectOption("cybertruck");
  await page.getByLabel("Template Variant").selectOption("cybertruck");
  await page.getByLabel("Vehicle Model").selectOption("model-3");
  await expect(page.getByLabel("Template Variant")).toHaveValue("");
  await expect(
    page.locator("form.discovery-filters").getByRole("link", {
      name: "Clear filters",
    }),
  ).toHaveAttribute("href", "/explore");
});
