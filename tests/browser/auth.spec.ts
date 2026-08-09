import { createHmac, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../src/lib/database.types";

const criticalProjects = new Set([
  "chromium",
  "firefox",
  "webkit",
  "mobile-chrome",
  "mobile-safari",
]);

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
}, testInfo) => {
  test.skip(!criticalProjects.has(testInfo.project.name));
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
    page.getByRole("heading", { name: "Your upload workshop is ready." }),
  ).toBeVisible();

  const session = await readSessionCookie(context);
  const userId = decodeJwt(session.access_token).sub as string;
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
    page.getByRole("heading", { name: "Your upload workshop is ready." }),
  ).toBeVisible();
  expect((await readSessionCookie(context)).access_token).not.toBe(
    expiredToken,
  );

  await page.getByRole("link", { name: "View Profile" }).click();
  await expect(page).toHaveURL(`/u/${username}`);
  await expect(
    page.getByRole("heading", { name: "Road Builder" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No published wraps yet." }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(email);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  const admin = createClient<Database>(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnvironment("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
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
  await page.goto(`/u/${username}`);
  await expect(page.getByText("This page could not be found")).toBeVisible();

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
