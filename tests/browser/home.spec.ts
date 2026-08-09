import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("guest sees the official catalog and honest discovery sections", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Make it yours.Share the road.",
  );
  await expect(
    page.getByText("5 vehicle models · 12 exact template variants available"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Browse the work." }),
  ).toBeVisible();
  for (const title of ["Trending", "Latest"]) {
    const section = page
      .locator(".home-discovery-block")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect(
      section.locator(".discovery-grid, .discovery-state"),
    ).toHaveCount(1);
  }

  for (const model of [
    "Model 3",
    "Model Y",
    "Model S",
    "Model X",
    "Cybertruck",
  ]) {
    await expect(
      page.getByRole("heading", { name: model, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("link", { name: "Model 3 Wraps" }),
  ).toHaveAttribute("href", "/models/model-3");
  await expect(page.getByRole("link", { name: "View all" })).toHaveCount(2);
  await expect(
    page.getByRole("link", { name: /Explore the Gallery/ }),
  ).toHaveAttribute("href", "/explore");

  const variantList = page.locator(".model-card li");
  for (const variant of [
    "Cybertruck",
    "Model 3",
    "Model 3 (2024+) Standard & Premium",
    "Model 3 (2024+) Performance",
    "Model Y",
    "Model Y (2025+) Standard",
    "Model Y (2025+) Premium",
    "Model Y (2025+) Performance",
    "Model Y L",
    "Model S (2021+)",
    "Model S (2025+) Plaid",
    "Model X (2021+)",
  ]) {
    await expect(variantList.getByText(variant, { exact: true })).toHaveCount(
      1,
    );
  }
  await expect(
    page.getByRole("link", { name: "Cybertruck 1024×768 ↗" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/cybertruck",
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  if (
    !testInfo.project.name.includes("webkit") &&
    testInfo.project.name !== "mobile-safari"
  ) {
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
  }

  if ((page.viewportSize()?.width ?? 1000) <= 1000) {
    await page.getByText("Menu", { exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Models", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Model 3 Wraps" }).click();
    await expect(page).toHaveURL(/\/models\/model-3$/);
    await page.goBack();
  }

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
