import { expect, test } from "@playwright/test";

test("unknown wrap slugs render the branded not-found surface", async ({
  page,
}) => {
  const response = await page.goto("/wrap/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found." }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Return to Homepage" }).click();
  await expect(page).toHaveURL(/:\d+\/$/);
});

test("unknown profiles render the branded not-found surface", async ({
  page,
}) => {
  const response = await page.goto("/u/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore Wraps" })).toBeVisible();
});
