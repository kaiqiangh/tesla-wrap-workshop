import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getClaims: mocks.getClaims, signOut: mocks.signOut },
  })),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error("redirect:" + path);
  }),
}));

import { signOut } from "./actions";

describe("signOut", () => {
  it("revokes the session server-side before redirecting home", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    mocks.signOut.mockResolvedValue({});
    await expect(signOut()).rejects.toThrow("redirect:/");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
  });
});