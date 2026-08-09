import { describe, expect, it } from "vitest";

import { readPublicEnvironment } from "./env";

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
});
