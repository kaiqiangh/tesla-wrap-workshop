import { expect, test } from "@playwright/test";

test("guest sees the official catalog and honest empty gallery", async ({
  page,
}) => {
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
});
