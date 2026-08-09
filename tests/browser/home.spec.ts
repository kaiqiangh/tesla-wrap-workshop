import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("guest sees the official catalog and honest empty gallery", async ({
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
    page.getByRole("heading", { name: "The first gallery is waiting." }),
  ).toBeVisible();

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
  await expect(page.getByText("No published wraps yet.")).toBeVisible();

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

  if ((page.viewportSize()?.width ?? 1000) <= 760) {
    await page.getByText("Menu", { exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Models", exact: true }),
    ).toBeVisible();
  }

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
