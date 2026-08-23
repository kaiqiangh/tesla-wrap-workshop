import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveProfile: vi.fn(),
  createAdmin: vi.fn(),
  createServer: vi.fn(),
}));

vi.mock("@/lib/auth/profile-access", () => ({
  requireActiveProfile: mocks.requireActiveProfile,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServer,
}));

import { POST } from "./route";

describe("POST /api/profile/avatar", () => {
  it("rejects an oversized declared body before parsing multipart data", async () => {
    mocks.createServer.mockResolvedValue({});
    mocks.requireActiveProfile.mockResolvedValue({
      ok: true,
      username: "road-one",
      userId: "10000000-0000-0000-0000-000000000003",
    });
    const oversized = new Request("http://localhost/api/profile/avatar", {
      method: "POST",
      headers: { "content-length": "999999999999999999999" },
    });
    const formData = vi.spyOn(oversized, "formData");

    const response = await POST(oversized);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("avatar_size");
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });
});
