import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  createAdmin: vi.fn(),
  createServer: vi.fn(),
  requireActiveProfile: vi.fn(),
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
vi.mock("@/lib/wraps/metadata", () => ({
  validateWrapMetadata: (input: {
    title: string;
    description: string;
    licenseType: string;
    tags: string[];
    templateAsserted: boolean;
    distributionAsserted: boolean;
  }) => ({
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
  }),
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

import { DELETE, PATCH, POST } from "./route";

const params = Promise.resolve({ slug: "night-drive-abc123" });

describe("/api/wraps/[slug] management", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps management owner-scoped", async () => {
    mocks.createServer.mockResolvedValue({});
    mocks.requireActiveProfile.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ error: { code: "WF-WRAP-PARTICIPATION" } }),
        { status: 403 },
      ),
    });
    const response = await PATCH(
      jsonRequest({
        title: "Updated",
        description: "",
        licenseType: "OTHER",
        tags: [],
      }),
      { params },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("WF-WRAP-PARTICIPATION");
  });

  it("edits metadata with canonical tags", async () => {
    setupOwner();
    mocks.adminRpc.mockResolvedValue({
      data: [
        {
          id: "1",
          slug: "night-drive-abc123",
          status: "PUBLISHED",
          first_published_at: "2026-08-09T18:00:00Z",
        },
      ],
      error: null,
    });
    const response = await PATCH(
      jsonRequest({
        title: "Updated",
        description: "A detail",
        licenseType: "OTHER",
        tags: ["Track Day"],
      }),
      { params },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).wrap.slug).toBe("night-drive-abc123");
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "edit_wrap",
      expect.objectContaining({ p_tags: ["track-day"] }),
    );
  });

  it("routes visibility actions to the matching transition RPC", async () => {
    setupOwner();
    mocks.adminRpc.mockResolvedValue({
      data: [
        {
          id: "1",
          slug: "night-drive-abc123",
          status: "UNPUBLISHED",
          first_published_at: "2026-08-09T18:00:00Z",
        },
      ],
      error: null,
    });
    const response = await POST(jsonRequest({ action: "unpublish" }), {
      params,
    });
    expect(response.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith("unpublish_wrap", {
      p_creator_id: "20000000-0000-0000-0000-000000000001",
      p_slug: "night-drive-abc123",
    });
  });

  it("replaces an immutable Asset Revision through the server RPC", async () => {
    setupOwner();
    mocks.adminRpc.mockResolvedValue({
      data: [
        {
          id: "1",
          slug: "night-drive-abc123",
          status: "PUBLISHED",
          asset_revision_id: "30000000-0000-4000-8000-000000000002",
          previous_asset_revision_id: "30000000-0000-4000-8000-000000000001",
          created: true,
        },
      ],
      error: null,
    });
    const response = await POST(
      jsonRequest({
        action: "replace",
        assetRevisionId: "30000000-0000-4000-8000-000000000002",
        templateVariantId: "10000000-0000-4000-8000-000000000001",
      }),
      { params },
    );
    expect(response.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith("replace_wrap_asset", {
      p_asset_revision_id: "30000000-0000-4000-8000-000000000002",
      p_creator_id: "20000000-0000-0000-0000-000000000001",
      p_slug: "night-drive-abc123",
      p_template_variant_id: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("rejects an incomplete replacement request before RPC", async () => {
    setupOwner();
    const response = await POST(
      jsonRequest({ action: "replace", assetRevisionId: "not-a-uuid" }),
      { params },
    );
    expect(response.status).toBe(400);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("removes through the terminal transition RPC", async () => {
    setupOwner();
    mocks.adminRpc.mockResolvedValue({
      data: [
        {
          id: "1",
          slug: "night-drive-abc123",
          status: "REMOVED",
          first_published_at: "2026-08-09T18:00:00Z",
        },
      ],
      error: null,
    });
    const response = await DELETE(
      new Request("http://localhost/api/wraps/night-drive-abc123"),
      { params },
    );
    expect(response.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "remove_wrap",
      expect.any(Object),
    );
  });
});

function setupOwner() {
  mocks.createServer.mockResolvedValue({});
  mocks.requireActiveProfile.mockResolvedValue({
    ok: true,
    username: "road-one",
    userId: "20000000-0000-0000-0000-000000000001",
  });
  mocks.createAdmin.mockReturnValue({ rpc: mocks.adminRpc });
}

function jsonRequest(value: unknown) {
  return new Request("http://localhost/api/wraps/night-drive-abc123", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
