import { describe, expect, it } from "vitest";

import { readPublicEnvironment, readServerEnvironment } from "./env";

const valid = {
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  WRAPFORGE_ENVIRONMENT: "local",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
};

describe("readPublicEnvironment", () => {
  it("accepts the local Docker environment", () => {
    expect(readPublicEnvironment(valid)).toEqual(valid);
  });

  it("fails closed when a required value is absent", () => {
    expect(() =>
      readPublicEnvironment({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "" }),
    ).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("rejects local Supabase credentials outside local mode", () => {
    expect(() =>
      readPublicEnvironment({ ...valid, WRAPFORGE_ENVIRONMENT: "production" }),
    ).toThrow("local Supabase URL");
  });

  it("rejects hosted Supabase credentials in local mode", () => {
    expect(() =>
      readPublicEnvironment({
        ...valid,
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toThrow("Local mode requires local site and Supabase URLs");
  });

  it("rejects a browser environment identity that disagrees with the server", () => {
    expect(() =>
      readPublicEnvironment({
        ...valid,
        NEXT_PUBLIC_WRAPFORGE_ENVIRONMENT: "production",
      }),
    ).toThrow("environment identities must match");
  });
});

describe("readServerEnvironment", () => {
  it("keeps the service credential in the server-only contract", () => {
    expect(
      readServerEnvironment({ ...valid, SUPABASE_SECRET_KEY: "local-secret" }),
    ).toMatchObject({ SUPABASE_SECRET_KEY: "local-secret" });
    expect(() => readServerEnvironment(valid)).toThrow("SUPABASE_SECRET_KEY");
  });
});
