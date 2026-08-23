import { createHash, createHmac, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import type { Database } from "../../src/lib/database.types";
import {
  decodeJwt,
  expectRouteBodyContains,
  expectRouteStatus,
  pngFixture,
  postWithRetry,
  readSessionCookie,
  requiredEnvironment,
  seedGoogleTestSession,
} from "./support";

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

test("Guest can begin Google sign-in", async ({ page, context }) => {
  await page.goto("/sign-in?next=/upload");

  await expect(
    page.getByRole("heading", { name: "Join the workshop" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
  await expect(page.locator("input")).toHaveCount(0);
  await context.setOffline(true);
  const authorizeRequest = page.waitForRequest("**/auth/v1/authorize**");
  await page
    .getByRole("button", { name: "Continue with Google" })
    .click({ noWaitAfter: true });
  const authorizeUrl = (await authorizeRequest).url();
  expect(authorizeUrl).toContain("provider=google");
  expect(
    decodeURIComponent(
      new URL(authorizeUrl).searchParams.get("redirect_to") ?? "",
    ),
  ).toContain("/auth/callback?next=/upload");
  await context.setOffline(false);
  await page.goto("/sign-in?next=/upload");
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

  await page.goto("/favorites");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Ffavorites$/);
});

test("Google sign-in recovers from a client dependency failure", async ({
  page,
}) => {
  await page.goto("/sign-in?next=/upload");
  await page.evaluate(() => {
    const subtle = window.crypto.subtle;
    const originalDigest = subtle.digest.bind(subtle);
    Object.defineProperty(subtle, "digest", {
      configurable: true,
      value: async () => {
        throw new Error("forced PKCE dependency failure");
      },
    });
    // The test restores digest explicitly after asserting the failure path,
    // so the patched digest keeps throwing regardless of how many times it
    // was called before (e.g. Next.js cache-busting in production builds).
    (window as unknown as { restoreTestDigest(): void }).restoreTestDigest =
      () => {
        Object.defineProperty(subtle, "digest", {
          configurable: true,
          value: originalDigest,
        });
      };
  });

  const button = page.getByRole("button", { name: "Continue with Google" });
  await button.click();
  await expect(
    page.getByText(
      "Google sign-in is temporarily unavailable. Please try again.",
    ),
  ).toBeVisible();
  await expect(button).toBeEnabled();

  await page.evaluate(() => {
    (window as unknown as { restoreTestDigest(): void }).restoreTestDigest();
  });
  const authorizeRequest = page.waitForRequest("**/auth/v1/authorize**");
  await button.click({ noWaitAfter: true });
  expect((await authorizeRequest).url()).toContain("provider=google");
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

test("Current administrator can review and recover a private Report", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  test.setTimeout(90_000);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const username = `mod${suffix}`;
  await seedGoogleTestSession(context, `moderator-${suffix}@example.test`);

  await page.goto("/auth/complete?next=%2Fadmin%2Freports");
  await expect(page).toHaveURL(/\/onboarding\?next=%2Fadmin%2Freports$/);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Display name").fill("Queue Moderator");
  await page.getByRole("button", { name: "Complete Profile" }).click();
  await expect(page).toHaveURL("/admin/reports");

  const session = await readSessionCookie(context);
  const userId = decodeJwt(session.access_token).sub as string;
  const admin = createClient<Database>(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnvironment("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const grant = await admin.rpc("set_admin_membership", {
    p_user_id: userId,
    p_active: true,
  });
  expect(grant.error).toBeNull();
  const targetContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
  });
  const targetPage = await targetContext.newPage();
  const targetUsername = `target${suffix}`;
  await seedGoogleTestSession(
    targetContext,
    `moderation-target-${suffix}@example.test`,
  );
  await targetPage.goto("/auth/complete?next=%2Fupload");
  await expect(targetPage).toHaveURL(/\/onboarding\?next=%2Fupload$/);
  await targetPage.getByLabel("Username").fill(targetUsername);
  await targetPage.getByLabel("Display name").fill("Moderation Target");
  await targetPage.getByRole("button", { name: "Complete Profile" }).click();
  await expect(targetPage).toHaveURL("/upload");
  const targetSession = await readSessionCookie(targetContext);
  const targetId = decodeJwt(targetSession.access_token).sub as string;
  const reportId = randomUUID();
  const report = await admin.from("reports").insert({
    id: reportId,
    reporter_id: userId,
    target_kind: "USER",
    target_id: targetId,
    target_ref: targetUsername,
    reason: "SPAM",
    idempotency_key: randomUUID(),
  });
  expect(report.error).toBeNull();

  await page.goto("/admin/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  const reportCard = page
    .locator(".admin-report-card")
    .filter({ hasText: targetUsername });
  await expect(reportCard).toBeVisible();
  const suspendResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/reports") &&
      response.request().method() === "POST",
  );
  await reportCard.getByRole("button", { name: "Suspend User" }).click();
  expect((await suspendResponse).status()).toBe(200);
  await expect(page.getByText("SUSPENDED", { exact: true })).toBeVisible();

  const reinstateResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/reports") &&
      response.request().method() === "POST",
  );
  await reportCard.getByRole("button", { name: "Reinstate User" }).click();
  expect((await reinstateResponse).status()).toBe(200);
  await expect(reportCard.getByText("ACTIVE", { exact: true })).toBeVisible();

  const deactivateReportId = randomUUID();
  const deactivateReport = await admin.from("reports").insert({
    id: deactivateReportId,
    reporter_id: userId,
    target_kind: "USER",
    target_id: targetId,
    target_ref: targetUsername,
    reason: "SPAM",
    idempotency_key: randomUUID(),
  });
  expect(deactivateReport.error).toBeNull();
  await page.reload();
  const openTargetReport = page
    .locator(".admin-report-card")
    .filter({ hasText: `${targetUsername} · reporter` })
    .filter({ hasText: "USER · OPEN" });
  await expect(openTargetReport).toBeVisible();
  const deactivateResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/reports") &&
      response.request().method() === "POST",
  );
  await openTargetReport
    .getByRole("button", { name: "Deactivate User" })
    .click();
  expect((await deactivateResponse).status()).toBe(200);
  const deactivatedCard = page
    .locator(".admin-report-card")
    .filter({ hasText: `${targetUsername} · reporter` })
    .filter({ hasText: "DEACTIVATED" });
  await expect(deactivatedCard).toBeVisible();
  await targetPage.goto(`/u/${targetUsername}`);
  await expect(
    targetPage.getByText("This Profile is unavailable.", { exact: true }),
  ).toBeVisible();
  const recoverResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/reports") &&
      response.request().method() === "POST",
  );
  await deactivatedCard.getByRole("button", { name: "Reinstate User" }).click();
  expect((await recoverResponse).status()).toBe(200);
  await expect(
    page
      .locator(".admin-report-card")
      .filter({ hasText: `${targetUsername} · reporter` })
      .last()
      .filter({ hasText: "ACTIVE" }),
  ).toBeVisible();
  await targetPage.goto(`/u/${targetUsername}`);
  await expect(
    targetPage.getByRole("heading", { name: "Moderation Target" }),
  ).toBeVisible();

  const revoke = await admin.rpc("set_admin_membership", {
    p_user_id: userId,
    p_active: false,
  });
  expect(revoke.error).toBeNull();
  const deniedQueue = await page.request.get("/api/admin/reports");
  expect(deniedQueue.status()).toBe(403);
  await targetContext.close();
});

test("User completes Google sign-in, onboarding, Profile, suspension, and logout", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.skip(!criticalProjects.has(testInfo.project.name));
  test.setTimeout(180_000);
  const suffix = `${testInfo.project.name}-${randomUUID()}`;
  const email = `browser-${suffix}@example.test`;
  const username = `road${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const guestPrincipal = `browser-guest-principal-${suffix}`;

  await page.goto("/upload");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fupload$/);
  const anonymousMutation = await page.request.post("/api/profile/onboarding", {
    data: { username: "anonymous", displayName: "Anonymous" },
  });
  expect(anonymousMutation.status()).toBe(401);
  await seedGoogleTestSession(context, email);
  await page.goto("/auth/complete?next=%2Fupload");
  await expect(page).toHaveURL(/\/onboarding\?next=%2Fupload$/);
  const authCookies = (await context.cookies()).filter((cookie) =>
    /-auth-token(?:\.\d+)?$/.test(cookie.name),
  );
  expect(authCookies.length).toBeGreaterThan(0);
  expect(authCookies.every((cookie) => cookie.httpOnly)).toBe(true);
  expect(authCookies.every((cookie) => cookie.sameSite === "Lax")).toBe(true);
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
  const startBody = (await startResponse.json()) as { id: string };
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
  await expect(
    page.getByRole("button", { name: "Follow", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("cannot Follow");
  await expect(
    page.getByRole("button", { name: "Follow", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.goto(`/wrap/${publishedSlug}`);
  await expect(
    page.getByRole("heading", { name: "Cybertruck Night Drive" }),
  ).toBeVisible();
  await expect(page.getByText("COMPATIBILITY CLAIM")).toBeVisible();
  await expect(page.getByText("Cybertruck — Cybertruck")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download Wrap" }),
  ).toHaveAttribute("href", `/wrap/${publishedSlug}/download`);
  await expect(page.locator(".wrap-detail-preview img")).toHaveAttribute(
    "src",
    `/api/wraps/${publishedSlug}/preview`,
  );
  const publishedRow = await admin
    .from("wraps")
    .select("id")
    .eq("slug", publishedSlug)
    .single();
  expect(publishedRow.error).toBeNull();
  await expect
    .poll(async () => {
      const viewEvents = await admin
        .from("core_loop_events")
        .select("id")
        .eq("event_kind", "WRAP_VIEW")
        .eq("target_id", publishedRow.data!.id);
      expect(viewEvents.error).toBeNull();
      return viewEvents.data?.length ?? 0;
    })
    .toBeGreaterThan(0);
  const comments = page.locator(".comments-section");
  const commentStat = page
    .locator(".wrap-stats div")
    .filter({ hasText: "Comments" })
    .locator("dd");
  await expect(
    comments.getByRole("heading", { name: "0 Comments" }),
  ).toBeVisible();
  const hostileComment = "<b>browser comment</b> & plain text";
  await page.getByLabel("Add a Comment").fill(hostileComment);
  const addCommentResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/wraps/${publishedSlug}/comments`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add Comment" }).click();
  const addedCommentResponse = await addCommentResponse;
  expect(addedCommentResponse.status()).toBe(200);
  const addedCommentBody = (await addedCommentResponse.json()) as {
    comment: { id: string };
  };
  const commentCard = comments.locator(".comment-card").filter({
    hasText: hostileComment,
  });
  await expect(commentCard).toBeVisible();
  await expect(commentStat).toHaveText("1");
  await expect(commentCard.locator("p").locator("b")).toHaveCount(0);
  await page.goto("/favorites");
  await expect(
    page.getByRole("heading", { name: "Your Favorites." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nothing published here yet." }),
  ).toBeVisible();
  await page.goto(`/wrap/${publishedSlug}`);
  await page.getByRole("button", { name: /^Like/ }).click();
  await expect(page.getByRole("status")).toContainText("cannot Like");

  if (testInfo.project.name === "chromium") {
    const actorContext = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
    });
    const actorPage = await actorContext.newPage();
    const actorEmail = `browser-actor-${randomUUID()}@example.test`;
    const actorUsername = `actor${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await seedGoogleTestSession(actorContext, actorEmail);
    await actorPage.goto(`/auth/complete?next=%2Fwrap%2F${publishedSlug}`);
    await expect(actorPage).toHaveURL(/\/onboarding\?next=/);
    await actorPage.getByLabel("Username").fill(actorUsername);
    await actorPage.getByLabel("Display name").fill("Social Viewer");
    await actorPage.getByRole("button", { name: "Complete Profile" }).click();
    await expect(actorPage).toHaveURL(`/wrap/${publishedSlug}`);
    await actorPage.goto(`/u/${username}`);
    await actorPage.getByRole("button", { name: "Report Profile" }).click();
    await actorPage.getByLabel("Reason").selectOption("SPAM");
    const profileReportResponse = actorPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/reports") &&
        response.request().method() === "POST",
    );
    await actorPage.getByRole("button", { name: "Submit Report" }).click();
    expect((await profileReportResponse).status()).toBe(200);
    await expect(actorPage.locator(".report-receipt")).toContainText(
      "Report OPEN",
    );
    await actorPage.getByRole("button", { name: "Close" }).click();
    const concurrentReportBody = {
      targetKind: "USER",
      target: username,
      reason: "OFFENSIVE_CONTENT",
      detail: null,
      idempotencyKey: randomUUID(),
    };
    const concurrentReports = await Promise.all(
      [0, 1].map(() =>
        actorPage.request.post("/api/reports", { data: concurrentReportBody }),
      ),
    );
    expect(concurrentReports.map((response) => response.status())).toEqual([
      200, 200,
    ]);
    const concurrentReportResults = await Promise.all(
      concurrentReports.map(async (response) => (await response.json()).report),
    );
    expect(
      concurrentReportResults.filter((report) => report.created),
    ).toHaveLength(1);
    expect(
      concurrentReportResults.filter((report) => !report.created),
    ).toHaveLength(1);
    await actorPage.goto(`/wrap/${publishedSlug}`);
    const actorCommentCard = actorPage.locator(".comment-card").filter({
      hasText: hostileComment,
    });
    await expect(actorCommentCard).toBeVisible();
    await actorCommentCard
      .getByRole("button", { name: "Report Comment" })
      .click();
    await actorPage.getByLabel("Reason").selectOption("OTHER");
    await actorPage
      .getByLabel(/Additional detail/)
      .fill("The comment needs a private review.");
    const commentReportResponse = actorPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/reports") &&
        response.request().method() === "POST",
    );
    await actorPage.getByRole("button", { name: "Submit Report" }).click();
    expect((await commentReportResponse).status()).toBe(200);
    await expect(actorPage.locator(".report-receipt")).toContainText(
      "Report OPEN",
    );
    await actorPage.getByRole("button", { name: "Close" }).click();
    await actorPage
      .getByRole("button", { name: "Report", exact: true })
      .click();
    await actorPage.getByLabel("Reason").selectOption("OTHER");
    await actorPage
      .getByLabel(/Additional detail/)
      .fill("The published Wrap needs a private review.");
    const wrapReportResponse = actorPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/reports") &&
        response.request().method() === "POST",
    );
    await actorPage.getByRole("button", { name: "Submit Report" }).click();
    expect((await wrapReportResponse).status()).toBe(200);
    await expect(actorPage.locator(".report-receipt")).toContainText(
      "Report OPEN",
    );
    await actorPage.getByRole("button", { name: "Close" }).click();
    await actorPage.goto(`/u/${username}`);
    await expect(
      actorPage.getByRole("button", { name: "Follow", exact: true }),
    ).toBeVisible();
    const firstFollowResponse = actorPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/profiles/${username}/follow`) &&
        response.request().method() === "POST",
    );
    await actorPage
      .getByRole("button", { name: "Follow", exact: true })
      .click();
    expect((await firstFollowResponse).status()).toBe(200);
    await expect(
      actorPage.getByRole("button", { name: "Following", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await actorPage.reload();
    await expect(
      actorPage.getByRole("button", { name: "Following", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const firstUnfollowResponse = actorPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/profiles/${username}/follow`) &&
        response.request().method() === "POST",
    );
    await actorPage
      .getByRole("button", { name: "Following", exact: true })
      .click();
    expect((await firstUnfollowResponse).status()).toBe(200);
    await expect(
      actorPage.getByRole("button", { name: "Follow", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    const actorProfile = await admin
      .from("profiles")
      .select("user_id")
      .eq("username", actorUsername)
      .single();
    expect(actorProfile.error).toBeNull();
    const suspendedActor = await admin
      .from("profiles")
      .update({ participation_state: "SUSPENDED" })
      .eq("user_id", actorProfile.data?.user_id ?? "");
    expect(suspendedActor.error).toBeNull();
    const deniedActorFollow = await actorPage.request.post(
      `/api/profiles/${username}/follow`,
      { data: { enabled: true } },
    );
    expect(deniedActorFollow.status()).toBe(403);
    expect(await deniedActorFollow.json()).toMatchObject({
      error: { code: "WF-FOLLOW-PARTICIPATION" },
    });
    const restoredActor = await admin
      .from("profiles")
      .update({ participation_state: "ACTIVE" })
      .eq("user_id", actorProfile.data?.user_id ?? "");
    expect(restoredActor.error).toBeNull();
    await actorPage.goto(`/u/${username}`);
    const restoredFollowResponse = actorPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/profiles/${username}/follow`) &&
        response.request().method() === "POST",
    );
    await actorPage
      .getByRole("button", { name: "Follow", exact: true })
      .click();
    expect((await restoredFollowResponse).status()).toBe(200);
    await expect(
      actorPage.getByRole("button", { name: "Following", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await actorPage.reload();
    await expect(
      actorPage.getByRole("button", { name: "Following", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const restoredUnfollowResponse = actorPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/profiles/${username}/follow`) &&
        response.request().method() === "POST",
    );
    await actorPage
      .getByRole("button", { name: "Following", exact: true })
      .click();
    expect((await restoredUnfollowResponse).status()).toBe(200);
    await expect(
      actorPage.getByRole("button", { name: "Follow", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await actorPage.goto(`/wrap/${publishedSlug}`);
    const likeResponse = actorPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/wraps/${publishedSlug}/engagement`) &&
        response.request().method() === "POST",
    );
    await actorPage.getByRole("button", { name: /^Like/ }).click();
    expect((await likeResponse).status()).toBe(200);
    await expect(
      actorPage.getByRole("button", { name: /^Liked/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const favoriteResponse = actorPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/wraps/${publishedSlug}/engagement`) &&
        response.request().method() === "POST",
    );
    await actorPage.getByRole("button", { name: /^Favorite/ }).click();
    expect((await favoriteResponse).status()).toBe(200);
    await expect(
      actorPage.getByRole("button", { name: /^Favorited/ }),
    ).toHaveAttribute("aria-pressed", "true");

    for (const path of ["/", "/explore", "/trending", "/models/cybertruck"]) {
      await actorPage.goto(path);
      const card = actorPage
        .locator("article.discovery-card")
        .filter({
          has: actorPage.locator(`a[href="/wrap/${publishedSlug}"]`),
        })
        .first();
      await expect(card).toBeVisible();
      await expect(
        card.getByRole("button", { name: /^Liked/ }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        card.getByRole("button", { name: /^Favorited/ }),
      ).toHaveAttribute("aria-pressed", "true");
    }

    await actorPage.goto("/favorites");
    const favoriteCard = actorPage.locator("article.discovery-card").filter({
      has: actorPage.locator(`a[href="/wrap/${publishedSlug}"]`),
    });
    await expect(favoriteCard).toBeVisible();
    await favoriteCard.getByRole("button", { name: /^Favorited/ }).click();
    await expect(
      actorPage.getByRole("heading", { name: "Nothing published here yet." }),
    ).toBeVisible();
    await actorContext.close();
  }
  const deleteCommentResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/comments/${addedCommentBody.comment.id}`) &&
      response.request().method() === "DELETE",
  );
  await commentCard.getByRole("button", { name: "Delete Comment" }).click();
  expect((await deleteCommentResponse).status()).toBe(200);
  await expect(commentCard).toHaveCount(0);
  await expect(commentStat).toHaveText("0");
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
  expect(firstDownload.headers()["x-correlation-id"]).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  expect(firstDownload.headers()["content-type"]).toContain("image/png");
  expect(firstDownload.headers()["content-disposition"]).toContain(
    'filename="Cybertruck-Night-Drive.png"',
  );
  expect(firstDownload.headers()["x-download-counted"]).toBe("true");
  const downloadedBytes = await firstDownload.body();
  expect(downloadedBytes.length).toBeGreaterThan(24);
  expect(downloadedBytes.length).toBeLessThanOrEqual(1_000_000);
  expect(createHash("sha256").update(downloadedBytes).digest("hex")).toBe(
    firstDownload.headers()["x-download-sha256"],
  );
  const downloadedMetadata = await sharp(downloadedBytes).metadata();
  expect(downloadedMetadata.width).toBe(1024);
  expect(downloadedMetadata.height).toBe(768);
  const repeatedDownload = await page.request.post(
    `/api/wraps/${publishedSlug}/download`,
  );
  expect(repeatedDownload.status()).toBe(200);
  expect(repeatedDownload.headers()["x-download-counted"]).toBe("false");
  expect((await repeatedDownload.body()).length).toBeGreaterThan(24);
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
  const downloadEvent = page.waitForEvent("download", { timeout: 10000 });
  await page.getByRole("button", { name: "Download Original Wrap" }).click();
  expect((await uiDownloadResponse).status()).toBe(200);
  await downloadEvent;
  await page.goto(`/wrap/${publishedSlug}/download`);
  const guestContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
  });
  await guestContext.addCookies([
    {
      name: "wf_guest_download",
      value: guestPrincipal,
      domain: "127.0.0.1",
      path: "/",
      secure: true,
    },
  ]);
  const guestPage = await guestContext.newPage();
  await guestPage.goto(`/u/${username}`);
  await guestPage.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(guestPage).toHaveURL(`/sign-in?next=%2Fu%2F${username}`);
  await guestPage.goto(`/wrap/${publishedSlug}`);
  await expect(
    guestPage
      .locator(".comments-section")
      .getByRole("link", { name: "Sign in" }),
  ).toHaveAttribute("href", `/sign-in?next=%2Fwrap%2F${publishedSlug}`);
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
      postWithRetry(guestPage.request, `/api/wraps/${publishedSlug}/download`, {
        headers: { cookie: `wf_guest_download=${guestPrincipal}` },
      }),
    ),
  );
  expect(guestResponses.every((response) => response.status() === 200)).toBe(
    true,
  );
  expect(
    guestResponses.filter(
      (response) => response.headers()["x-download-counted"] === "true",
    ).length,
  ).toBe(1);
  const { data: guestWrap } = await admin
    .from("wraps")
    .select("id, download_count")
    .eq("slug", publishedSlug)
    .single();
  const guestPrincipalHash = `v1:${createHmac(
    "sha256",
    requiredEnvironment("DOWNLOAD_PRINCIPAL_HMAC_SECRET"),
  )
    .update(guestPrincipal)
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
  const guestPreviewContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
  });
  const guestPreview = await guestPreviewContext.request.get(
    `/api/wraps/${publishedSlug}/preview`,
  );
  expect(guestPreview.status()).toBe(200);
  expect(guestPreview.headers()["set-cookie"]).toBeUndefined();
  await guestPreviewContext.close();
  const previewResponse = await page.request.get(
    `/api/wraps/${publishedSlug}/preview`,
  );
  expect(previewResponse.status()).toBe(200);
  const previewEtag = previewResponse.headers().etag;
  expect(previewEtag).toMatch(/^"[a-f0-9]{64}"$/);
  const notModifiedPreview = await page.request.get(
    `/api/wraps/${publishedSlug}/preview`,
    { headers: { "If-None-Match": previewEtag } },
  );
  expect(notModifiedPreview.status()).toBe(304);
  expect(notModifiedPreview.headers()["cache-control"]).toBe(
    "public, max-age=0, must-revalidate",
  );
  try {
    const deactivateCreator = await admin
      .from("profiles")
      .update({ participation_state: "DEACTIVATED" })
      .eq("user_id", userId);
    expect(deactivateCreator.error).toBeNull();
    const deactivatedPreview = await page.request.get(
      `/api/wraps/${publishedSlug}/preview`,
      { headers: { "If-None-Match": previewEtag } },
    );
    expect(deactivatedPreview.status()).toBe(404);
    expect(deactivatedPreview.headers()["cache-control"]).toBe("no-store");
  } finally {
    const reactivateCreator = await admin
      .from("profiles")
      .update({ participation_state: "ACTIVE" })
      .eq("user_id", userId);
    expect(reactivateCreator.error).toBeNull();
  }
  const restoredPreview = await page.request.get(
    `/api/wraps/${publishedSlug}/preview`,
    { headers: { "If-None-Match": previewEtag } },
  );
  expect(restoredPreview.status()).toBe(304);
  expect(restoredPreview.headers()["cache-control"]).toBe(
    "public, max-age=0, must-revalidate",
  );
  await page.getByLabel("Title").fill("Cybertruck Night Drive Updated");
  await page.getByRole("button", { name: "Save metadata" }).click();
  await expect(page.getByLabel("Title")).toHaveValue(
    "Cybertruck Night Drive Updated",
  );
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByText("UNPUBLISHED", { exact: true })).toBeVisible();
  const withdrawnPreview = await page.request.get(
    `/api/wraps/${publishedSlug}/preview`,
    { headers: { "If-None-Match": previewEtag } },
  );
  expect(withdrawnPreview.status()).toBe(404);
  expect(withdrawnPreview.headers()["cache-control"]).toBe("no-store");
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
    const validBody = (await validStart.json()) as { id: string };
    const validTransfer = await page.request.post(
      `/api/uploads/${validBody.id}/object`,
      {
        multipart: {
          file: {
            name: "valid.png",
            mimeType: "image/png",
            buffer: await pngFixture(width, height),
          },
        },
      },
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
    const invalidBody = (await invalidStart.json()) as { id: string };
    const invalidTransfer = await page.request.post(
      `/api/uploads/${invalidBody.id}/object`,
      {
        multipart: {
          file: {
            name: "invalid.png",
            mimeType: "image/png",
            buffer: await pngFixture(wrongWidth, wrongHeight),
          },
        },
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
  const parallel = (await parallelStart.json()) as { id: string };
  const parallelTransfer = await page.request.post(
    `/api/uploads/${parallel.id}/object`,
    {
      multipart: {
        file: {
          name: "parallel.png",
          mimeType: "image/png",
          buffer: await pngFixture(1024, 768),
        },
      },
    },
  );
  expect(parallelTransfer.status()).toBe(200);
  const concurrent = await Promise.all(
    Array.from({ length: 20 }, async () => {
      let response = await postWithRetry(
        page.request,
        `/api/uploads/${parallel.id}/finalize`,
      );
      for (
        let attempt = 0;
        attempt < 3 && response.status() !== 200;
        attempt++
      ) {
        const body = (await response.json()) as {
          error?: { code?: string };
        };
        // A concurrent finalizer may observe the staging object mid-consumption
        // (WF-UPLOAD-STAGING) or the authoritative validation still running
        // (WF-UPLOAD-BUSY); both mean "retry the same request", so accept
        // either code while converging on the single 200 Asset Revision.
        expect(
          [503, 409].includes(response.status()) &&
            ["WF-UPLOAD-BUSY", "WF-UPLOAD-STAGING"].includes(
              body.error?.code ?? "",
            ),
        ).toBe(true);
        response = await postWithRetry(
          page.request,
          `/api/uploads/${parallel.id}/finalize`,
        );
      }
      return response;
    }),
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
      postWithRetry(page.request, `/api/uploads/${startBody.id}/finalize`),
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
    {
      headers: {
        apikey: requiredEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
        authorization: `Bearer ${requiredEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")}`,
        "content-type": "image/png",
      },
      data: await pngFixture(1024, 768),
    },
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
  const corrupt = (await corruptStart.json()) as { id: string };
  const corruptTransfer = await page.request.post(
    `/api/uploads/${corrupt.id}/object`,
    {
      multipart: {
        file: {
          name: "corrupt.png",
          mimeType: "image/png",
          buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        },
      },
    },
  );
  expect(corruptTransfer.status()).toBe(200);
  const overwrite = await page.request.post(
    `/api/uploads/${corrupt.id}/object`,
    {
      multipart: {
        file: {
          name: "corrupt-retry.png",
          mimeType: "image/png",
          buffer: await pngFixture(1024, 768),
        },
      },
    },
  );
  // #59 staging-retry byte identity: only a byte-identical re-upload is
  // accepted as idempotent; a different PNG must conflict.
  expect(overwrite.status()).toBe(409);
  expect(await overwrite.json()).toMatchObject({
    error: { problem: "A different file already occupies this transfer." },
  });
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
  await page.goto("/upload");
  await page.getByRole("radio", { name: /^Cybertruck/ }).check();
  await page
    .getByLabel("I used the selected matching official Tesla template.")
    .check();
  let abortedTransfer = false;
  await page.route("**/api/uploads/*/object", async (route) => {
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
  await page.unroute("**/api/uploads/*/object");

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
  await expect(
    page.getByRole("button", { name: "Follow", exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(email);

  await page.goto("/settings/profile");
  await expect(
    page.getByRole("heading", { name: "Make your identity yours." }),
  ).toBeVisible();
  await page.getByLabel("Username").fill("-bad");
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(
    page.getByText(/starting with a letter or number/),
  ).toBeVisible();
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
  let avatarAttempts = 0;
  let profileSettingsRequests = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/profile/settings") &&
      request.method() === "PUT"
    )
      profileSettingsRequests += 1;
  });
  await page.route("**/api/profile/avatar", async (route) => {
    avatarAttempts += 1;
    if (avatarAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Try again after the upload service recovers." },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(
    page.getByText(
      "Profile details were saved, but your avatar could not be saved. Try again after the upload service recovers.",
    ),
  ).toBeVisible();
  expect(profileSettingsRequests).toBe(1);
  expect(avatarAttempts).toBe(1);
  await page.getByRole("button", { name: "Retry avatar upload" }).click();
  await expect(page).toHaveURL(`/u/${renamedUsername}`);
  expect(profileSettingsRequests).toBe(1);
  expect(avatarAttempts).toBe(2);
  await page.unroute("**/api/profile/avatar");
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
  const suspendedFollow = await page.request.post(
    `/api/profiles/${renamedUsername}/follow`,
    { data: { enabled: true } },
  );
  expect(suspendedFollow.status()).toBe(403);
  expect(await suspendedFollow.json()).toMatchObject({
    error: { code: "WF-FOLLOW-PARTICIPATION" },
  });

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
