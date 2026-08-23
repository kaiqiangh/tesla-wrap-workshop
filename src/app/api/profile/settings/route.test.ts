import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveProfile: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/profile-access", () => ({
  requireActiveProfile: mocks.requireActiveProfile,
}));
vi.mock("@/lib/profile/settings", () => ({
  validateProfileSettings: (input: {
    username: string;
    displayName: string;
    bio: string;
  }) =>
    input.username.startsWith("-")
      ? {
          ok: false,
          code: "invalid_username",
          message: "Username must be valid.",
        }
      : { ok: true, value: input },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({ rpc: mocks.rpc })),
}));

import { PUT } from "./route";

describe("PUT /api/profile/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveProfile.mockResolvedValue({
      ok: true,
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.rpc.mockResolvedValue({
      data: [{ username: "road-one", display_name: "Road One", bio: "Bio" }],
      error: null,
    });
  });

  it("rejects malformed fields before touching the database", async () => {
    const response = await PUT(
      new Request("http://localhost/api/profile/settings", {
        method: "PUT",
        body: JSON.stringify({ username: "-bad", displayName: "", bio: "" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires an eligible signed-in Profile", async () => {
    mocks.requireActiveProfile.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ error: { code: "authentication_required" } }),
        { status: 401 },
      ),
    });
    const response = await PUT(
      new Request("http://localhost/api/profile/settings", {
        method: "PUT",
        body: JSON.stringify({
          username: "road-one",
          displayName: "Road One",
          bio: "",
        }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("maps the cooldown conflict and returns the allowlisted result", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "username_cooldown" },
    });
    const conflict = await PUT(
      new Request("http://localhost/api/profile/settings", {
        method: "PUT",
        body: JSON.stringify({
          username: "road-two",
          displayName: "Road Two",
          bio: "",
        }),
      }),
    );
    expect(conflict.status).toBe(409);

    const success = await PUT(
      new Request("http://localhost/api/profile/settings", {
        method: "PUT",
        body: JSON.stringify({
          username: "road-one",
          displayName: "Road One",
          bio: "Bio",
        }),
      }),
    );
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({
      username: "road-one",
      display_name: "Road One",
      bio: "Bio",
    });
  });
});
