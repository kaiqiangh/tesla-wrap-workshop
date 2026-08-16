import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.admin,
}));

import { GET } from "./route";

const slug = "night-drive-abc";
const sha256 = "a".repeat(64);

describe("GET /api/wraps/[slug]/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows shared revalidation for an eligible public preview", async () => {
    const download = vi.fn(async () => ({
      data: new Blob(["png"], { type: "image/png" }),
      error: null,
    }));
    mocks.admin.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: [{ object_key: "preview/object.png", sha256 }],
        error: null,
      })),
      storage: { from: vi.fn(() => ({ download })) },
    });

    const response = await GET(
      new Request(`http://localhost/${slug}/preview`),
      {
        params: Promise.resolve({ slug }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(response.headers.get("etag")).toBe(`"${sha256}"`);
    expect(response.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    expect(download).toHaveBeenCalledWith("preview/object.png");
  });

  it("keeps unavailable previews uncacheable", async () => {
    mocks.admin.mockReturnValue({
      rpc: vi.fn(async () => ({ data: null, error: new Error("missing") })),
    });

    const response = await GET(
      new Request(`http://localhost/${slug}/preview`),
      {
        params: Promise.resolve({ slug }),
      },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
