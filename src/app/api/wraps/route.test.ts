import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  createAdmin: vi.fn(),
  createServer: vi.fn(),
  readProfileAccess: vi.fn(),
}));

vi.mock("@/lib/auth/profile-access", () => ({
  readProfileAccess: mocks.readProfileAccess,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServer,
}));
vi.mock("@/lib/wraps/metadata", () => ({
  validateWrapMetadata: (input: {
    title: string;
    description: string;
    licenseType: string;
    tags: string[];
    templateAsserted: boolean;
    distributionAsserted: boolean;
  }) => {
    if (!input.title.trim()) {
      return {
        ok: false,
        problem: {
          code: "WF-WRAP-TITLE",
          measured: "0 characters",
          nextAction: "Use a title between 1 and 80 characters.",
        },
      };
    }
    return {
      ok: true,
      value: {
        ...input,
        title: input.title.trim(),
        description: input.description.trim(),
        licenseType: input.licenseType,
        tags: [
          ...new Set(
            input.tags.map((tag) => tag.toLowerCase().replaceAll(" ", "-")),
          ),
        ],
        templateAsserted: true,
        distributionAsserted: true,
      },
    };
  },
}));
vi.mock("@/lib/wraps/problem", () => ({
  wrapProblem: (
    status: number,
    code: string,
    problem: string,
    rule: string,
    nextAction: string,
  ) =>
    new Response(
      JSON.stringify({ error: { code, problem, rule, nextAction } }),
      {
        status,
        headers: { "content-type": "application/json" },
      },
    ),
}));

import { POST } from "./route";

const input = {
  assetRevisionId: "40000000-0000-0000-0000-000000000001",
  templateVariantId: "10000000-0000-0000-0000-000000000001",
  title: "Night Drive",
  description: "A restrained community wrap.",
  licenseType: "PERSONAL_USE_ALLOWED",
  tags: ["Night Drive", "tesla"],
  templateAsserted: true,
  distributionAsserted: true,
};

describe("POST /api/wraps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a completed active Profile", async () => {
    mocks.createServer.mockResolvedValue({});
    mocks.readProfileAccess.mockResolvedValue({ status: "guest" });
    const response = await POST(jsonRequest(input));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("WF-WRAP-AUTH");
  });

  it("rejects invalid metadata before reaching the database", async () => {
    const response = await POST(jsonRequest({ ...input, title: " " }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("WF-WRAP-TITLE");
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("publishes through the service-only RPC and returns the stable identity", async () => {
    mocks.createServer.mockResolvedValue({});
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.adminRpc.mockResolvedValue({
      data: [
        {
          id: "50000000-0000-0000-0000-000000000001",
          slug: "night-drive-abc123",
          status: "PUBLISHED",
          first_published_at: "2026-08-09T18:00:00Z",
          asset_revision_id: input.assetRevisionId,
          template_variant_id: input.templateVariantId,
          created: true,
        },
      ],
      error: null,
    });
    mocks.createAdmin.mockReturnValue({ rpc: mocks.adminRpc });

    const response = await POST(jsonRequest(input));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      created: true,
      wrap: { slug: "night-drive-abc123", status: "PUBLISHED" },
    });
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "publish_wrap",
      expect.objectContaining({
        p_creator_id: "20000000-0000-0000-0000-000000000001",
        p_tags: ["night-drive", "tesla"],
      }),
    );
  });

  it("maps an authoritative readiness failure", async () => {
    mocks.createServer.mockResolvedValue({});
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { message: "wrap_assets_incomplete" },
    });
    mocks.createAdmin.mockReturnValue({ rpc: mocks.adminRpc });
    const response = await POST(jsonRequest(input));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("WF-WRAP-ASSET");
  });

  it("rejects a repeated submission whose metadata is stale", async () => {
    mocks.createServer.mockResolvedValue({});
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { message: "wrap_duplicate_mismatch" },
    });
    mocks.createAdmin.mockReturnValue({ rpc: mocks.adminRpc });
    const response = await POST(jsonRequest(input));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("WF-WRAP-DUPLICATE");
  });

  it("rejects a repeated submission for a removed Wrap", async () => {
    mocks.createServer.mockResolvedValue({});
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { message: "wrap_removed_duplicate" },
    });
    mocks.createAdmin.mockReturnValue({ rpc: mocks.adminRpc });
    const response = await POST(jsonRequest(input));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("WF-WRAP-REMOVED");
  });

  it("rejects a repeated submission for a hidden Wrap", async () => {
    mocks.createServer.mockResolvedValue({});
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      username: "road-one",
      userId: "20000000-0000-0000-0000-000000000001",
    });
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { message: "wrap_hidden_duplicate" },
    });
    mocks.createAdmin.mockReturnValue({ rpc: mocks.adminRpc });
    const response = await POST(jsonRequest(input));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("WF-WRAP-HIDDEN");
  });
});

function jsonRequest(value: unknown) {
  return new Request("http://localhost/api/wraps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
