import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  createServer: vi.fn(),
  readProfileAccess: vi.fn(),
  finalizePng: vi.fn(),
  persistAssetRevision: vi.fn(),
  ValidationError: class ValidationError extends Error {
    code: string;
    measured: string;
    rule: string;
    nextAction: string;

    constructor(
      code: string,
      measured: string,
      rule: string,
      nextAction: string,
    ) {
      super(code);
      this.code = code;
      this.measured = measured;
      this.rule = rule;
      this.nextAction = nextAction;
    }
  },
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
vi.mock("@/lib/upload/image", () => ({
  finalizePng: mocks.finalizePng,
  UploadValidationError: mocks.ValidationError,
}));
vi.mock("@/lib/upload/persist", () => ({
  persistAssetRevision: mocks.persistAssetRevision,
}));
vi.mock("@/lib/upload/problem", () => ({
  uploadProblem: (
    status: number,
    code: string,
    problem: string,
    rule: string,
    nextAction: string,
    headers: HeadersInit = {},
  ) =>
    new Response(
      JSON.stringify({ error: { code, problem, rule, nextAction } }),
      {
        status,
        headers: { "content-type": "application/json", ...headers },
      },
    ),
}));

import { POST } from "./route";

const id = "10000000-0000-0000-0000-000000000001";
const owner = "30000000-0000-0000-0000-000000000001";
const pending = {
  id,
  owner_id: owner,
  staging_key: `${owner}/${id}/source.png`,
  original_filename: "model3.png",
  declared_mime_type: "image/png",
  template_asserted: true,
  template_variant_id: "20000000-0000-0000-0000-000000000001",
  width_px: 1024,
  height_px: 1024,
  max_file_bytes: 1000000,
  state: "UPLOADED",
  failure_code: null,
  failure_detail: null,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  asset_revision_id: null,
};
const variantFixtures = [
  ["Model 3", 1024, 1024],
  ["Model 3 (2024+) Standard & Premium", 1024, 1024],
  ["Model 3 (2024+) Performance", 1024, 1024],
  ["Model Y", 1024, 1024],
  ["Model Y (2025+) Standard", 1024, 1024],
  ["Model Y (2025+) Premium", 1024, 1024],
  ["Model Y (2025+) Performance", 1024, 1024],
  ["Model Y L", 1024, 1024],
  ["Model S (2021+)", 1024, 1024],
  ["Model S (2025+) Plaid", 1024, 1024],
  ["Model X (2021+)", 1024, 1024],
  ["Cybertruck", 1024, 768],
] as const;

type PersistenceProbe = {
  assets: { bucket: string; key: string; bytes: Buffer }[];
  store: (asset: {
    bucket: string;
    key: string;
    bytes: Buffer;
  }) => Promise<void>;
  remove: (
    assets: { bucket: string; key: string; bytes: Buffer }[],
  ) => Promise<boolean>;
  complete: () => Promise<"complete" | "failed" | "unknown">;
  fail: (code: string) => Promise<boolean>;
};

function arrange(
  options: {
    storageFailure?: boolean;
    databaseFailure?: boolean;
    claimRateLimited?: boolean;
    width?: number;
    height?: number;
    existingAssetMismatch?: boolean;
    successful?: boolean;
    dimensionFailure?: string;
  } = {},
) {
  const serverRpc = vi.fn(async () => ({
    data: [
      {
        ...pending,
        width_px: options.width ?? pending.width_px,
        height_px: options.height ?? pending.height_px,
      },
    ],
    error: null,
  }));
  const adminRpc = vi.fn(async (name: string) => {
    if (name === "claim_pending_upload") {
      if (options.claimRateLimited) {
        return { data: null, error: new Error("upload_rate_limited") };
      }
      return { data: [{ claimed: true, state: "VALIDATING" }], error: null };
    }
    if (name === "complete_pending_upload" && options.databaseFailure) {
      return { data: null, error: new Error("injected database failure") };
    }
    if (name === "complete_pending_upload" && options.successful) {
      return { data: id, error: null };
    }
    return { data: null, error: null };
  });
  const admin = {
    rpc: adminRpc,
    storage: {
      from: (bucket: string) => ({
        info: async () => ({ data: { size: 100 }, error: null }),
        download: async () => ({
          data: new Blob([options.existingAssetMismatch ? "mismatch" : "png"], {
            type: "image/png",
          }),
          error: null,
        }),
        upload: async () => ({
          data: null,
          error:
            options.storageFailure ||
            (options.existingAssetMismatch && bucket === "wrap-originals")
              ? new Error("injected storage failure")
              : null,
        }),
        remove: async () => ({ data: null, error: null }),
      }),
    },
    from: (relation: string) => {
      if (relation === "pending_uploads") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                options.databaseFailure
                  ? {
                      data: { state: "VALIDATING", asset_revision_id: null },
                      error: null,
                    }
                  : { data: null, error: new Error("not used") },
            }),
          }),
        };
      }
      return {
        upsert: async () => ({ error: null }),
      };
    },
  };
  mocks.createServer.mockResolvedValue({ rpc: serverRpc });
  mocks.createAdmin.mockReturnValue(admin);
  mocks.readProfileAccess.mockResolvedValue({
    status: "active",
    username: "upload-one",
  });
  const width = options.width ?? pending.width_px;
  const height = options.height ?? pending.height_px;
  mocks.finalizePng.mockResolvedValue({
    original: {
      bytes: Buffer.from("original"),
      width,
      height,
      sha256: "a".repeat(64),
    },
    preview: {
      bytes: Buffer.from("preview"),
      width: Math.min(width, 640),
      height: Math.min(height, 640),
      sha256: "b".repeat(64),
    },
    thumbnail: {
      bytes: Buffer.from("thumbnail"),
      width: Math.min(width, 320),
      height: Math.min(height, 320),
      sha256: "c".repeat(64),
    },
  });
  if (options.dimensionFailure) {
    mocks.finalizePng.mockRejectedValue(
      new mocks.ValidationError(
        "WF-UPLOAD-DIMENSIONS",
        options.dimensionFailure,
        "The staged PNG must match the selected Template Variant dimensions.",
        "Export from the selected official template and start a fresh upload.",
      ),
    );
  }
  mocks.persistAssetRevision.mockImplementation(
    async (persistence: PersistenceProbe) => {
      const stored: PersistenceProbe["assets"] = [];
      for (const asset of persistence.assets) {
        try {
          await persistence.store(asset);
          stored.push(asset);
        } catch {
          await persistence.remove(stored);
          return (await persistence.fail("WF-UPLOAD-STORAGE"))
            ? "WF-UPLOAD-STORAGE"
            : "WF-UPLOAD-DATABASE-UNKNOWN";
        }
      }
      const completion = await persistence.complete();
      if (completion === "unknown") return "WF-UPLOAD-DATABASE-UNKNOWN";
      if (completion === "failed") {
        await persistence.remove(stored);
        return (await persistence.fail("WF-UPLOAD-DATABASE"))
          ? "WF-UPLOAD-DATABASE"
          : "WF-UPLOAD-DATABASE-UNKNOWN";
      }
      return "READY";
    },
  );
  return adminRpc;
}

describe("POST /api/uploads/[id]/finalize", () => {
  it.each(variantFixtures)(
    "turns an injected Storage failure into a stable response for %s",
    async (_, width, height) => {
      const adminRpc = arrange({ storageFailure: true, width, height });
      const response = await POST(new Request("http://localhost"), {
        params: Promise.resolve({ id }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: "WF-UPLOAD-STORAGE",
          problem: "The validated assets could not be stored.",
          rule: "READY requires the Original, preview, and thumbnail to all exist privately.",
          nextAction: "Start a fresh upload after the service recovers.",
        },
      });
      expect(adminRpc).toHaveBeenCalledWith(
        "fail_pending_upload",
        expect.objectContaining({
          p_id: id,
          p_code: "WF-UPLOAD-STORAGE",
        }),
      );
    },
  );

  it.each(variantFixtures)(
    "authoritatively finalizes the selected dimensions for %s",
    async (_, width, height) => {
      arrange({ successful: true, width, height });
      const response = await POST(new Request("http://localhost"), {
        params: Promise.resolve({ id }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        state: "READY",
        assetRevisionId: id,
        width,
        height,
      });
    },
  );

  it.each(variantFixtures)(
    "rejects wrong authoritative dimensions for %s",
    async (_, width, height) => {
      const wrong = width === 1024 && height === 768 ? "1024×1024" : "1024×768";
      const adminRpc = arrange({
        width,
        height,
        dimensionFailure: wrong,
      });
      const response = await POST(new Request("http://localhost"), {
        params: Promise.resolve({ id }),
      });
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("WF-UPLOAD-DIMENSIONS");
      expect(adminRpc).toHaveBeenCalledWith(
        "fail_pending_upload",
        expect.objectContaining({
          p_id: id,
          p_code: "WF-UPLOAD-DIMENSIONS",
        }),
      );
    },
  );

  it("retains objects when a database completion outcome is ambiguous", async () => {
    const adminRpc = arrange({ databaseFailure: true });
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "WF-UPLOAD-DATABASE-UNKNOWN",
    );
    expect(adminRpc).not.toHaveBeenCalledWith(
      "fail_pending_upload",
      expect.anything(),
    );
  });

  it("rejects same-size existing objects with a different hash", async () => {
    const adminRpc = arrange({ existingAssetMismatch: true });
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("WF-UPLOAD-STORAGE");
    expect(adminRpc).toHaveBeenCalledWith(
      "fail_pending_upload",
      expect.objectContaining({ p_code: "WF-UPLOAD-STORAGE" }),
    );
  });

  it("returns Retry-After when a new finalization is rate limited", async () => {
    arrange({ claimRateLimited: true });
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect((await response.json()).error.code).toBe("WF-UPLOAD-RATE");
  });
});
