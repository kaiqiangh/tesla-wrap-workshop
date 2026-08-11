import { createHash, createHmac, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import type { Database } from "../../src/lib/database.types";

const criticalProjects = new Set([
  "chromium",
  "firefox",
  "webkit",
  "mobile-chrome",
  "mobile-safari",
]);
const browserVariants = [
  ["Model 3", "1024×1024"],
  ["Model 3 (2024+) Standard & Premium", "1024×1024"],
  ["Model 3 (2024+) Performance", "1024×1024"],
  ["Model Y", "1024×1024"],
  ["Model Y (2025+) Standard", "1024×1024"],
  ["Model Y (2025+) Premium", "1024×1024"],
  ["Model Y (2025+) Performance", "1024×1024"],
  ["Model Y L", "1024×1024"],
  ["Model S (2021+)", "1024×1024"],
  ["Model S (2025+) Plaid", "1024×1024"],
  ["Model X (2021+)", "1024×1024"],
  ["Cybertruck", "1024×768"],
] as const;

test("Guest can begin email OTP or Google sign-in", async ({ page }) => {
  await page.goto("/sign-in?next=/upload");

  await expect(
    page.getByRole("heading", { name: "Join the workshop" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send six-digit code" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Google sign-in is enabled in the hosted development"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("OAuth callback rejects missing codes and external destinations", async ({
  page,
}) => {
  await page.goto(
    "/auth/callback?next=https%3A%2F%2Fattacker.example%2Fcollect",
  );
  await expect(page).toHaveURL(/\/sign-in\?error=oauth_failed&next=%2F$/);
  await expect(
    page.getByText("That sign-in could not be completed."),
  ).toBeVisible();

  await page.goto("/sign-in?error=__proto__");
  await expect(
    page.getByRole("heading", { name: "Join the workshop" }),
  ).toBeVisible();
  await expect(page.locator(".form-error")).toHaveCount(0);
});

test("User completes local OTP, onboarding, refresh, Profile, suspension, and logout", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.skip(!criticalProjects.has(testInfo.project.name));
  test.setTimeout(180_000);
  const suffix = `${testInfo.project.name}-${randomUUID()}`;
  const email = `browser-${suffix}@example.test`;
  const username = `road${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  await page.goto("/upload");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fupload$/);
  const anonymousMutation = await page.request.post("/api/profile/onboarding", {
    data: { username: "anonymous", displayName: "Anonymous" },
  });
  expect(anonymousMutation.status()).toBe(401);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send six-digit code" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();

  const otp = await readOtp(email);
  const wrongOtp = `${otp.slice(0, 5)}${otp.endsWith("0") ? "1" : "0"}`;
  await page.getByLabel("Six-digit code").fill(wrongOtp);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByText("invalid or expired")).toBeVisible();

  await page.getByLabel("Six-digit code").fill(otp);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL(/\/onboarding\?next=%2Fupload$/);
  const otherUserMutation = await page.request.post("/api/profile/onboarding", {
    data: {
      userId: "00000000-0000-0000-0000-000000000000",
      username: "other-user",
      displayName: "Other User",
    },
  });
  expect(otherUserMutation.status()).toBe(400);

  await page.getByLabel("Username").fill("tesla");
  await page.getByLabel("Display name").fill("Brand Confusion");
  await page.getByRole("button", { name: "Complete Profile" }).click();
  await expect(page.getByText("That Username is unavailable.")).toBeVisible();

  await page.getByLabel("Username").fill(username.toUpperCase());
  await page.getByLabel("Display name").fill("Road Builder");
  await page.getByRole("button", { name: "Complete Profile" }).click();
  await expect(page).toHaveURL(/\/upload$/);
  await expect(
    page.getByRole("heading", {
      name: "Build a Template-verified Wrap Asset.",
    }),
  ).toBeVisible();
  for (const [name, dimensions] of browserVariants) {
    const card = page
      .locator(".variant-card")
      .filter({ hasText: name })
      .filter({ hasText: `${dimensions} · Active` })
      .first();
    await expect(card).toBeVisible();
    await expect(
      card.getByRole("link", { name: "Official Tesla template source" }),
    ).toHaveAttribute("href", /github\.com\/teslamotors\/custom-wraps/);
  }

  const session = await readSessionCookie(context);
  const userId = decodeJwt(session.access_token).sub as string;
  const admin = createClient<Database>(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnvironment("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const expiredToken = expireJwt(
    session.access_token,
    requiredEnvironment("SUPABASE_JWT_SECRET"),
  );
  await writeSessionCookie(context, {
    ...session,
    access_token: expiredToken,
    expires_at: Math.floor(Date.now() / 1000) - 60,
  });
  await page.goto("/upload");
  await expect(
    page.getByRole("heading", {
      name: "Build a Template-verified Wrap Asset.",
    }),
  ).toBeVisible();

  await page.getByRole("radio", { name: /^Cybertruck/ }).check();
  await expect(page.getByText("1024×768 · Active")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Official Tesla template source" }).last(),
  ).toHaveAttribute("href", /github\.com\/teslamotors\/custom-wraps/);
  await page
    .getByLabel("I used the selected matching official Tesla template.")
    .check();
  const fileInput = page.getByLabel(/^Choose PNG/);
  await fileInput.setInputFiles({
    name: "wrong-square.png",
    mimeType: "image/png",
    buffer: await pngFixture(1024, 1024),
  });
  await expect(page.getByText("WF-UPLOAD-DIMENSIONS")).toBeVisible();
  await expect(page.getByText("1024×1024", { exact: true })).toBeVisible();

  const startedPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/uploads") &&
      response.request().method() === "POST",
  );
  const finalizedPromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/uploads/") &&
      response.url().endsWith("/finalize"),
  );
  let forcedUnknown = false;
  await page.route("**/api/uploads/*/finalize", async (route) => {
    if (!forcedUnknown) {
      forcedUnknown = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "WF-UPLOAD-DATABASE-UNKNOWN",
            problem: "The final database outcome could not be confirmed.",
            rule: "Asset objects remain private until READY or FAILED is read back durably.",
            nextAction:
              "Retry this same finalization request after the service recovers.",
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  await fileInput.setInputFiles({
    name: "cybertruck.png",
    mimeType: "image/png",
    buffer: await pngFixture(1024, 768),
  });
  const startResponse = await startedPromise;
  const startBody = (await startResponse.json()) as {
    id: string;
    staging_key: string;
  };
  const firstFinalResponse = await finalizedPromise;
  expect(firstFinalResponse.status()).toBe(503);
  expect((await firstFinalResponse.json()).error.code).toBe(
    "WF-UPLOAD-DATABASE-UNKNOWN",
  );
  await expect(
    page.getByRole("button", { name: "Retry this finalization" }),
  ).toBeVisible();
  const retryFinalizedPromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/uploads/${startBody.id}/finalize`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Retry this finalization" }).click();
  const finalResponse = await retryFinalizedPromise;
  const finalBody = (await finalResponse.json()) as {
    assetRevisionId: string;
  };
  expect(finalResponse.status()).toBe(200);
  await page.unroute("**/api/uploads/*/finalize");
  await expect(
    page.getByText("READY ASSET REVISION", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1024×768 normalized PNG")).toBeVisible();

  await page.getByLabel("Wrap title").fill("Cybertruck Night Drive");
  await page.getByLabel("Wrap description").fill("A verified community wrap.");
  await page.getByLabel("Wrap tags").fill("Night Drive, cybertruck");
  await page
    .getByLabel("I own this artwork or have permission to distribute it.")
    .check();
  await page.getByRole("button", { name: "Publish Wrap" }).click();
  await expect(page.getByText("Published Wrap is ready.")).toBeVisible();
  const publishedHref = await page
    .getByRole("link", { name: "View Wrap detail" })
    .getAttribute("href");
  expect(publishedHref).toMatch(/^\/wrap\/[a-z0-9-]+$/);
  const publishedSlug = publishedHref!.split("/").at(-1)!;
  const browseOriginalRequests: string[] = [];
  const browseRequestListener = (request: { url: () => string }) => {
    if (request.url().includes("/wrap-originals")) {
      browseOriginalRequests.push(request.url());
    }
  };
  page.on("request", browseRequestListener);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Browse the work." }),
  ).toBeVisible();
  await expect(
    page.locator(`a[href="/wrap/${publishedSlug}"]`).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cybertruck Wraps" }),
  ).toHaveAttribute("href", "/models/cybertruck");
  await page.goto("/explore");
  await expect(
    page.getByRole("heading", { name: "Explore the gallery." }),
  ).toBeVisible();
  await expect(
    page.locator(`a[href="/wrap/${publishedSlug}"]`).first(),
  ).toBeVisible();
  await page.goto("/trending");
  await expect(
    page.getByRole("heading", { name: "What the community is seeing." }),
  ).toBeVisible();
  await expect(
    page.locator(`a[href="/wrap/${publishedSlug}"]`).first(),
  ).toBeVisible();
  await page.goto("/models/cybertruck");
  await expect(
    page.getByRole("heading", { name: "Cybertruck Wraps" }),
  ).toBeVisible();
  await expect(
    page.locator(`a[href="/wrap/${publishedSlug}"]`).first(),
  ).toBeVisible();
  page.off("request", browseRequestListener);
  expect(browseOriginalRequests).toEqual([]);
  await expectRouteBodyContains(
    () => page.request.get(`/u/${username}`),
    "Cybertruck Night Drive",
  );
  await page.goto(`/u/${username}`);
  await expect(
    page.getByText("Published Wraps", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Counted Downloads", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cybertruck Night Drive" }),
  ).toBeVisible();
  await page.goto(`/wrap/${publishedSlug}`);
  await expect(
    page.getByRole("heading", { name: "Cybertruck Night Drive" }),
  ).toBeVisible();
  await expect(page.getByText("COMPATIBILITY CLAIM")).toBeVisible();
  await expect(page.getByText("Cybertruck — Cybertruck")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download Wrap" }),
  ).toHaveAttribute("href", `/wrap/${publishedSlug}/download`);
  await page.getByRole("button", { name: /^Like/ }).click();
  await expect(page.getByRole("status")).toContainText("cannot Like");
  await page.goto(`/wrap/${publishedSlug}/download`);
  await expect(
    page.getByRole("heading", { name: "Download Cybertruck Night Drive" }),
  ).toBeVisible();
  await expect(
    page.getByText("Exact Template Variant: Cybertruck"),
  ).toBeVisible();
  await expect(page.getByText("Use Tesla App 4.59.0 or newer.")).toBeVisible();
  if (testInfo.project.name.startsWith("mobile-")) {
    expect(
      await page
        .locator(".download-actions")
        .evaluate((element) => getComputedStyle(element).position),
    ).toBe("sticky");
  }
  const firstDownload = await page.request.post(
    `/api/wraps/${publishedSlug}/download`,
  );
  expect(firstDownload.status()).toBe(200);
  const firstDownloadBody = (await firstDownload.json()) as {
    downloadUrl: string;
    expiresAt: string;
    filename: string;
    counted: boolean;
    sha256: string;
    templateVariant: { key: string; widthPx: number; heightPx: number };
  };
  expect(firstDownloadBody).toMatchObject({
    filename: "Cybertruck-Night-Drive.png",
    counted: true,
    templateVariant: { key: "cybertruck", widthPx: 1024, heightPx: 768 },
  });
  expect(
    new Date(firstDownloadBody.expiresAt).getTime() - Date.now(),
  ).toBeLessThanOrEqual(60_000);
  const downloadedAsset = await page.request.get(firstDownloadBody.downloadUrl);
  expect(downloadedAsset.status()).toBe(200);
  const downloadedBytes = await downloadedAsset.body();
  expect(downloadedBytes.length).toBeGreaterThan(24);
  expect(downloadedBytes.length).toBeLessThanOrEqual(1_000_000);
  expect(createHash("sha256").update(downloadedBytes).digest("hex")).toBe(
    firstDownloadBody.sha256,
  );
  const downloadedMetadata = await sharp(downloadedBytes).metadata();
  expect(downloadedMetadata.width).toBe(1024);
  expect(downloadedMetadata.height).toBe(768);
  const repeatedDownload = await page.request.post(
    `/api/wraps/${publishedSlug}/download`,
  );
  const repeatedBody = await repeatedDownload.json();
  expect(repeatedBody.counted).toBe(false);
  const repeatedAsset = await page.request.get(repeatedBody.downloadUrl);
  expect(repeatedAsset.status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Download Original Wrap" }),
  ).toBeVisible();
  await page.route(`**/api/wraps/${publishedSlug}/download`, async (route) => {
    await route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({
        error: { nextAction: "The private link expired. Retry the download." },
      }),
    });
  });
  await page.getByRole("button", { name: "Download Original Wrap" }).click();
  await expect(page.getByRole("status")).toContainText("private link expired");
  await page.unroute(`**/api/wraps/${publishedSlug}/download`);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });
  await page.getByRole("button", { name: "Share confirmation" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Confirmation link copied",
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => undefined,
    });
  });
  await page.getByRole("button", { name: "Share confirmation" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Confirmation link shared",
  );
  const uiDownloadResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/wraps/${publishedSlug}/download`) &&
      response.request().method() === "POST",
  );
  const signedNavigation = Promise.race([
    page.waitForEvent("download", { timeout: 10000 }),
    page.waitForURL(/\/storage\/v1\/object\/sign\//, { timeout: 10000 }),
  ]);
  await page.getByRole("button", { name: "Download Original Wrap" }).click();
  expect((await uiDownloadResponse).status()).toBe(200);
  await signedNavigation.catch(() => undefined);
  await page.goto(`/wrap/${publishedSlug}/download`);
  const guestContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
  });
  await guestContext.addCookies([
    {
      name: "wf_guest_download",
      value: "browser-guest-principal",
      domain: "127.0.0.1",
      path: "/",
      secure: true,
    },
  ]);
  const guestPage = await guestContext.newPage();
  await guestPage.goto(`/wrap/${publishedSlug}`);
  await guestPage.getByRole("button", { name: /^Like/ }).click();
  await expect(guestPage).toHaveURL(`/sign-in?next=%2Fwrap%2F${publishedSlug}`);
  await guestPage.goto(`/wrap/${publishedSlug}/download`);
  await expect(
    guestPage.getByRole("heading", { name: "Download Cybertruck Night Drive" }),
  ).toBeVisible();
  const { data: beforeGuestWrap } = await admin
    .from("wraps")
    .select("download_count")
    .eq("slug", publishedSlug)
    .single();
  const guestResponses = await Promise.all(
    Array.from({ length: 20 }, () =>
      guestPage.request.post(`/api/wraps/${publishedSlug}/download`, {
        headers: { cookie: "wf_guest_download=browser-guest-principal" },
      }),
    ),
  );
  expect(guestResponses.every((response) => response.status() === 200)).toBe(
    true,
  );
  const guestBodies = await Promise.all(
    guestResponses.map((response) => response.json()),
  );
  expect(guestBodies.filter((body) => body.counted).length).toBe(1);
  const { data: guestWrap } = await admin
    .from("wraps")
    .select("id, download_count")
    .eq("slug", publishedSlug)
    .single();
  const guestPrincipalHash = `v1:${createHmac(
    "sha256",
    requiredEnvironment("DOWNLOAD_PRINCIPAL_HMAC_SECRET"),
  )
    .update("browser-guest-principal")
    .digest("hex")}`;
  const { data: guestEvents, error: guestEventsError } = await admin
    .from("download_events")
    .select("id, counted")
    .eq("wrap_id", guestWrap!.id)
    .eq("principal_hash", guestPrincipalHash);
  expect(guestEventsError).toBeNull();
  expect(guestEvents).toHaveLength(20);
  expect(guestEvents?.filter((event) => event.counted)).toHaveLength(1);
  expect(guestWrap?.download_count).toBe(
    (beforeGuestWrap?.download_count ?? 0) + 1,
  );
  await guestContext.close();
  await page.goto(`/u/${username}`);
  await expect(page.locator(".profile-stats dd").nth(1)).toHaveText("1");
  await expect(page.locator(".profile-stats dd").nth(2)).toHaveText("2");
  await page.goto(`/wrap/${publishedSlug}`);
  await Promise.all([
    page.waitForURL(`/wrap/${publishedSlug}/edit`, { timeout: 15000 }),
    page.getByRole("link", { name: "Manage Wrap" }).click(),
  ]);
  await page.getByLabel("Title").fill("Cybertruck Night Drive Updated");
  await page.getByRole("button", { name: "Save metadata" }).click();
  await expect(page.getByLabel("Title")).toHaveValue(
    "Cybertruck Night Drive Updated",
  );
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByText("UNPUBLISHED", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Republish" })).toBeVisible();
  await expectRouteStatus(
    () => page.request.get(`/wrap/${publishedSlug}`),
    404,
  );
  await page.getByRole("button", { name: "Republish" }).click();
  await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
  await expectRouteBodyContains(
    () => page.request.get(`/wrap/${publishedSlug}`),
    "Cybertruck Night Drive Updated",
  );
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Remove Wrap" }).click();
  await expect(page).toHaveURL(`/u/${username}`);
  await expectRouteStatus(
    () => page.request.get(`/wrap/${publishedSlug}`),
    404,
  );
  await page.goto("/upload");

  const storageHeaders = {
    apikey: requiredEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    authorization: `Bearer ${(await readSessionCookie(context)).access_token}`,
    "content-type": "image/png",
    "x-upsert": "false",
  };
  for (const [name, dimensions] of browserVariants) {
    const card = page
      .locator(".variant-card")
      .filter({ hasText: name })
      .first();
    const variantId = await card
      .locator('input[name="template-variant"]')
      .inputValue();
    const [width, height] = dimensions.split("×").map(Number);
    const validStart = await page.request.post("/api/uploads", {
      data: {
        templateVariantId: variantId,
        filename: `${name.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}-valid.png`,
        mimeType: "image/png",
        templateAsserted: true,
      },
    });
    expect(validStart.status()).toBe(201);
    const validBody = (await validStart.json()) as {
      id: string;
      staging_key: string;
    };
    const validTransfer = await page.request.post(
      `${requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL")}/storage/v1/object/wrap-staging/${validBody.staging_key}`,
      { headers: storageHeaders, data: await pngFixture(width, height) },
    );
    expect(validTransfer.status()).toBe(200);
    const validFinal = await page.request.post(
      `/api/uploads/${validBody.id}/finalize`,
    );
    expect(validFinal.status()).toBe(200);
    expect(await validFinal.json()).toMatchObject({
      state: "READY",
      width,
      height,
    });
    const wrongWidth = 1024;
    const wrongHeight = height === 768 ? 1024 : 768;
    const invalidStart = await page.request.post("/api/uploads", {
      data: {
        templateVariantId: variantId,
        filename: `${name.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}-invalid.png`,
        mimeType: "image/png",
        templateAsserted: true,
      },
    });
    expect(invalidStart.status()).toBe(201);
    const invalidBody = (await invalidStart.json()) as {
      id: string;
      staging_key: string;
    };
    const invalidTransfer = await page.request.post(
      `${requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL")}/storage/v1/object/wrap-staging/${invalidBody.staging_key}`,
      {
        headers: storageHeaders,
        data: await pngFixture(wrongWidth, wrongHeight),
      },
    );
    expect(invalidTransfer.status()).toBe(200);
    const invalidFinal = await page.request.post(
      `/api/uploads/${invalidBody.id}/finalize`,
    );
    expect(invalidFinal.status()).toBe(422);
    expect(await invalidFinal.json()).toMatchObject({
      error: { code: "WF-UPLOAD-DIMENSIONS" },
    });
    const staleFixtureTime = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString();
    const resetFixtures = await admin
      .from("pending_uploads")
      .update({
        created_at: staleFixtureTime,
        finalize_started_at: staleFixtureTime,
      })
      .eq("owner_id", userId)
      .in("id", [validBody.id, invalidBody.id]);
    expect(resetFixtures.error).toBeNull();
  }
  const cybertruckVariantId = await page
    .getByRole("radio", { name: /^Cybertruck/ })
    .getAttribute("value");
  expect(cybertruckVariantId).toBeTruthy();
  const parallelStart = await page.request.post("/api/uploads", {
    data: {
      templateVariantId: cybertruckVariantId,
      filename: "parallel.png",
      mimeType: "image/png",
      templateAsserted: true,
    },
  });
  expect(parallelStart.status()).toBe(201);
  const parallel = (await parallelStart.json()) as {
    id: string;
    staging_key: string;
  };
  const parallelTransfer = await page.request.post(
    `${requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL")}/storage/v1/object/wrap-staging/${parallel.staging_key}`,
    { headers: storageHeaders, data: await pngFixture(1024, 768) },
  );
  expect(parallelTransfer.status()).toBe(200);
  const concurrent = await Promise.all(
    Array.from({ length: 20 }, () =>
      page.request.post(`/api/uploads/${parallel.id}/finalize`),
    ),
  );
  expect(concurrent.every((response) => response.status() === 200)).toBe(true);
  expect(
    new Set(
      await Promise.all(
        concurrent.map(
          async (response) =>
            ((await response.json()) as { assetRevisionId: string })
              .assetRevisionId,
        ),
      ),
    ).size,
  ).toBe(1);
  const repeated = await Promise.all(
    Array.from({ length: 20 }, () =>
      page.request.post(`/api/uploads/${startBody.id}/finalize`),
    ),
  );
  expect(repeated.every((response) => response.status() === 200)).toBe(true);
  expect(
    new Set(
      await Promise.all(
        repeated.map(
          async (response) =>
            ((await response.json()) as { assetRevisionId: string })
              .assetRevisionId,
        ),
      ),
    ),
  ).toEqual(new Set([finalBody.assetRevisionId]));

  const arbitraryKey = await page.request.post(
    `${requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL")}/storage/v1/object/wrap-staging/${userId}/chosen/source.png`,
    { headers: storageHeaders, data: await pngFixture(1024, 768) },
  );
  expect(arbitraryKey.status()).toBe(400);
  for (const filename of ["transfer-one.png", "transfer-two.png"]) {
    const started = await page.request.post("/api/uploads", {
      data: {
        templateVariantId: cybertruckVariantId,
        filename,
        mimeType: "image/png",
        templateAsserted: true,
      },
    });
    expect(started.status()).toBe(201);
    const upload = (await started.json()) as { id: string };
    const abandoned = await page.request.delete(`/api/uploads/${upload.id}`);
    expect(abandoned.status()).toBe(200);
  }
  const freshAfterTransferFailures = await page.request.post("/api/uploads", {
    data: {
      templateVariantId: cybertruckVariantId,
      filename: "transfer-retry.png",
      mimeType: "image/png",
      templateAsserted: true,
    },
  });
  expect(freshAfterTransferFailures.status()).toBe(201);
  const transferRetry = (await freshAfterTransferFailures.json()) as {
    id: string;
  };
  expect(
    (await page.request.delete(`/api/uploads/${transferRetry.id}`)).status(),
  ).toBe(200);
  const corruptStart = await page.request.post("/api/uploads", {
    data: {
      templateVariantId: cybertruckVariantId,
      filename: "corrupt.png",
      mimeType: "image/png",
      templateAsserted: true,
    },
  });
  expect(corruptStart.status()).toBe(201);
  const corrupt = (await corruptStart.json()) as {
    id: string;
    staging_key: string;
  };
  const corruptTransfer = await page.request.post(
    `${requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL")}/storage/v1/object/wrap-staging/${corrupt.staging_key}`,
    {
      headers: storageHeaders,
      data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  );
  expect(corruptTransfer.status()).toBe(200);
  const overwrite = await page.request.post(
    `${requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL")}/storage/v1/object/wrap-staging/${corrupt.staging_key}`,
    { headers: storageHeaders, data: await pngFixture(1024, 768) },
  );
  expect(overwrite.status()).toBe(400);
  const corruptFinal = await page.request.post(
    `/api/uploads/${corrupt.id}/finalize`,
  );
  expect(corruptFinal.status()).toBe(422);
  expect(await corruptFinal.json()).toMatchObject({
    error: { code: "WF-UPLOAD-DECODE" },
  });
  const repeatedFailure = await page.request.post(
    `/api/uploads/${corrupt.id}/finalize`,
  );
  expect(repeatedFailure.status()).toBe(422);
  expect(await repeatedFailure.json()).toMatchObject({
    error: { code: "WF-UPLOAD-DECODE" },
  });
  const freshRetry = await page.request.post("/api/uploads", {
    data: {
      templateVariantId: cybertruckVariantId,
      filename: "fresh.png",
      mimeType: "image/png",
      templateAsserted: true,
    },
  });
  expect(freshRetry.status()).toBe(201);
  const freshRetryBody = (await freshRetry.json()) as { id: string };
  expect(freshRetryBody.id).not.toBe(corrupt.id);
  expect(
    (await page.request.delete(`/api/uploads/${freshRetryBody.id}`)).status(),
  ).toBe(200);
  expect((await readSessionCookie(context)).access_token).not.toBe(
    expiredToken,
  );

  await page.goto("/upload");
  await page.getByRole("radio", { name: /^Cybertruck/ }).check();
  await page
    .getByLabel("I used the selected matching official Tesla template.")
    .check();
  let abortedTransfer = false;
  await page.route("**/storage/v1/object/wrap-staging/**", async (route) => {
    if (!abortedTransfer && route.request().method() === "POST") {
      abortedTransfer = true;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.getByLabel(/^Choose PNG/).setInputFiles({
    name: "ui-transfer-failure.png",
    mimeType: "image/png",
    buffer: await pngFixture(1024, 768),
  });
  await expect(page.getByText("WF-UPLOAD-TRANSFER")).toBeVisible();
  await page.unroute("**/storage/v1/object/wrap-staging/**");

  await page.getByRole("link", { name: "View Profile" }).click();
  await expect(page).toHaveURL(`/u/${username}`);
  await expect(
    page.getByRole("heading", { name: "Road Builder" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "No published Wraps are available right now.",
    }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(email);

  await page.goto("/settings/profile");
  await expect(
    page.getByRole("heading", { name: "Make your identity yours." }),
  ).toBeVisible();
  await page.getByLabel("Username").fill("-bad");
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page.getByText(/Username must be/)).toBeVisible();
  const renamedUsername = `${username}new`;
  await page.getByLabel("Username").fill(renamedUsername);
  await page.getByLabel("Bio").fill("A Dublin creator.");
  await page.getByLabel("Avatar").setInputFiles({
    name: "avatar.webp",
    mimeType: "image/webp",
    buffer: await sharp({
      create: { width: 12, height: 8, channels: 4, background: "#a8f7d2" },
    })
      .webp()
      .toBuffer(),
  });
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page).toHaveURL(`/u/${renamedUsername}`);
  await page.goto(`/u/${username.toUpperCase()}`);
  await expect(page).toHaveURL(`/u/${renamedUsername}`);
  await expect(page.getByText("A Dublin creator.")).toBeVisible();
  await expect(page.locator(".profile-avatar img")).toBeVisible();
  const avatarResponse = await page.request.get(
    `/api/profiles/${renamedUsername}/avatar`,
  );
  expect(avatarResponse.status()).toBe(200);
  expect((await avatarResponse.body()).byteLength).toBeGreaterThan(0);

  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  const suspended = await admin
    .from("profiles")
    .update({ participation_state: "SUSPENDED" })
    .eq("user_id", userId);
  expect(suspended.error).toBeNull();

  await page.goto("/upload");
  await expect(page).toHaveURL(/error=profile_unavailable/);
  const denied = await page.request.post("/api/profile/onboarding", {
    data: { username: "another", displayName: "Another" },
  });
  expect(denied.status()).toBe(403);
  await page.goto(`/u/${renamedUsername}`);
  await expect(
    page.getByRole("heading", {
      name: "This Profile is temporarily unavailable.",
    }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(email);

  const restored = await admin
    .from("profiles")
    .update({ participation_state: "ACTIVE" })
    .eq("user_id", userId);
  expect(restored.error).toBeNull();
  await page.goto("/upload");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/upload");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fupload$/);
});

type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  [key: string]: unknown;
};

async function readOtp(email: string): Promise<string> {
  const mailpit = requiredEnvironment("SUPABASE_MAILPIT_URL");
  let otp = "";
  await expect
    .poll(
      async () => {
        const inbox = (await fetch(`${mailpit}/api/v1/messages?limit=100`).then(
          (response) => response.json(),
        )) as {
          messages: { ID: string; To: { Address: string }[] }[];
        };
        const message = inbox.messages.find((candidate) =>
          candidate.To.some((recipient) => recipient.Address === email),
        );
        if (!message) return "";
        const detail = (await fetch(
          `${mailpit}/api/v1/message/${message.ID}`,
        ).then((response) => response.json())) as { Text: string };
        otp = detail.Text.match(/\b\d{6}\b/)?.[0] ?? "";
        return otp;
      },
      { timeout: 10_000 },
    )
    .toMatch(/^\d{6}$/);
  return otp;
}

async function expectRouteStatus(
  request: () => Promise<{ status(): number }>,
  status: number,
) {
  await expect
    .poll(
      async () => {
        try {
          return (await request()).status();
        } catch {
          return 0;
        }
      },
      { timeout: 15000 },
    )
    .toBe(status);
}

async function expectRouteBodyContains(
  request: () => Promise<{ status(): number; text(): Promise<string> }>,
  expected: string,
) {
  await expect
    .poll(
      async () => {
        try {
          const response = await request();
          return response.status() === 200 ? await response.text() : "";
        } catch {
          return "";
        }
      },
      { timeout: 15000 },
    )
    .toContain(expected);
}

async function readSessionCookie(context: BrowserContext): Promise<Session> {
  const cookies = (await context.cookies())
    .filter((cookie) => /-auth-token(?:\.\d+)?$/.test(cookie.name))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  expect(cookies.length).toBeGreaterThan(0);
  const encoded = cookies.map((cookie) => cookie.value).join("");
  return JSON.parse(
    Buffer.from(encoded.replace(/^base64-/, ""), "base64url").toString(),
  ) as Session;
}

async function writeSessionCookie(context: BrowserContext, session: Session) {
  const current = (await context.cookies()).filter((cookie) =>
    /-auth-token(?:\.\d+)?$/.test(cookie.name),
  );
  expect(current.length).toBeGreaterThan(0);
  const baseName = current[0]!.name.replace(/\.\d+$/, "");
  await context.clearCookies({
    name: new RegExp(`^${baseName.replaceAll(".", "\\.")}`),
  });
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const chunks = encoded.match(/.{1,3000}/g) ?? [];
  const template = current[0]!;
  await context.addCookies(
    chunks.map((value, index) => ({
      name: chunks.length === 1 ? baseName : `${baseName}.${index}`,
      value,
      domain: template.domain,
      path: template.path,
      httpOnly: template.httpOnly,
      secure: template.secure,
      sameSite: template.sameSite,
    })),
  );
}

function expireJwt(token: string, secret: string): string {
  const [header, payload] = token.split(".");
  if (!header || !payload) throw new Error("Unexpected access token");
  const claims = decodeJwt(token);
  claims.exp = Math.floor(Date.now() / 1000) - 60;
  const body = `${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

async function pngFixture(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 38, g: 247, b: 185, alpha: 0.72 },
    },
  })
    .png()
    .toBuffer();
}

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Unexpected access token");
  return JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<
    string,
    unknown
  >;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing test environment: ${name}`);
  return value;
}
