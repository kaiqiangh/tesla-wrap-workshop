import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  expect,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import type { Database } from "../../src/lib/database.types";

type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  [key: string]: unknown;
};

export async function seedGoogleTestSession(
  context: BrowserContext,
  email: string,
) {
  const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const admin = createClient<Database>(
    supabaseUrl,
    requiredEnvironment("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: {
      avatar_url: "https://example.test/google-avatar.png",
      full_name: "Test Google User",
      name: "Test Google User",
    },
  });
  if (created.error || !created.data.user) {
    throw (
      created.error ?? new Error("Could not create the browser fixture User")
    );
  }

  const sessionId = randomUUID();
  const identityId = randomUUID();
  const providerId = `google-${created.data.user.id}`;
  const refreshToken = randomBytes(9).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signTestJwt(
    {
      aud: "authenticated",
      exp: now + 3600,
      iat: now,
      iss: `${supabaseUrl}/auth/v1`,
      role: "authenticated",
      session_id: sessionId,
      sub: created.data.user.id,
      email,
      app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: created.data.user.user_metadata,
      aal: "aal1",
    },
    requiredEnvironment("SUPABASE_JWT_SECRET"),
  );
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_tesla-wrap-workshop",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      `user_id=${created.data.user.id}`,
      "-v",
      `session_id=${sessionId}`,
      "-v",
      `refresh_token=${refreshToken}`,
      "-v",
      `identity_id=${identityId}`,
      "-v",
      `provider_id=${providerId}`,
      "-v",
      `email=${email}`,
      "-f",
      "-",
    ],
    {
      input:
        "delete from auth.identities where user_id = :'user_id'::uuid; insert into auth.identities (provider_id, user_id, identity_data, provider, email, id, created_at, updated_at) values (:'provider_id', :'user_id'::uuid, jsonb_build_object('provider_id', :'provider_id', 'sub', :'provider_id', 'email', :'email', 'email_verified', true, 'name', 'Test Google User'), 'google', :'email', :'identity_id'::uuid, now(), now()); insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (:'session_id'::uuid, :'user_id'::uuid, now(), now(), 'aal1'); insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, session_id) values ('00000000-0000-0000-0000-000000000000'::uuid, :'refresh_token', :'user_id', false, now(), now(), :'session_id'::uuid);\n",
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  const session: Session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: now + 3600,
    token_type: "bearer",
    user: created.data.user,
  };

  const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString(
    "base64url",
  )}`;
  const chunks = encoded.match(/.{1,3000}/g) ?? [];
  await context.addCookies(
    chunks.map((value, index) => ({
      name: chunks.length === 1 ? storageKey : `${storageKey}.${index}`,
      value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
}

export async function expectRouteStatus(
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

export async function expectRouteBodyContains(
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

export async function postWithRetry(
  request: APIRequestContext,
  url: string,
  options?: Parameters<APIRequestContext["post"]>[1],
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await request.post(url, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError;
}

export async function readSessionCookie(
  context: BrowserContext,
): Promise<Session> {
  const cookies = (await context.cookies())
    .filter((cookie) => /-auth-token(?:\.\d+)?$/.test(cookie.name))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  expect(cookies.length).toBeGreaterThan(0);
  const encoded = cookies.map((cookie) => cookie.value).join("");
  return JSON.parse(
    Buffer.from(encoded.replace(/^base64-/, ""), "base64url").toString(),
  ) as Session;
}

export async function pngFixture(width: number, height: number) {
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

function signTestJwt(claims: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const body = `${header}.${payload}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Unexpected access token");
  return JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<
    string,
    unknown
  >;
}

export function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing test environment: ${name}`);
  return value;
}
