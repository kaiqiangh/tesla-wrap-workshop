import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  createAdmin: vi.fn(),
  readProfileAccess: vi.fn(),
}));

vi.mock("@/lib/auth/profile-access", () => ({
  readProfileAccess: mocks.readProfileAccess,
}));
vi.mock("@/lib/observability", () => ({
  observeRoute: (
    _request: Request,
    _action: string,
    _target: string,
    handler: (operation: { actorId?: string }) => unknown,
  ) => handler({}),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServer,
}));
vi.mock("@/lib/upload/problem", () => ({
  uploadProblem: (
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

const id = "10000000-0000-0000-0000-000000000002";

function request() {
  const body = new FormData();
  body.append("file", new File(["png"], "wrap.png", { type: "image/png" }));
  return new Request(`http://localhost/api/uploads/${id}/object`, {
    method: "POST",
    body,
  });
}

describe("POST /api/uploads/[id]/object", () => {
  it("rejects an oversized declared body before parsing multipart data", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      userId: "10000000-0000-0000-0000-000000000003",
    });
    mocks.createServer.mockResolvedValue({});
    mocks.createAdmin.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: [
          {
            id,
            state: "CREATED",
            staging_key: "private/key.png",
            owner_id: "10000000-0000-0000-0000-000000000003",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            max_file_bytes: 100,
          },
        ],
        error: null,
      })),
    });
    const oversized = new Request(`http://localhost/api/uploads/${id}/object`, {
      method: "POST",
      headers: { "content-length": "999999999999999999999" },
    });
    const formData = vi.spyOn(oversized, "formData");

    const response = await POST(oversized, { params: Promise.resolve({ id }) });

    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("WF-UPLOAD-SIZE");
    expect(formData).not.toHaveBeenCalled();
  });

  it("uploads through the server boundary without returning a key", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      userId: "10000000-0000-0000-0000-000000000003",
    });
    mocks.createServer.mockResolvedValue({});
    mocks.createAdmin.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: [
          {
            id,
            state: "CREATED",
            staging_key: "private/key.png",
            owner_id: "10000000-0000-0000-0000-000000000003",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            max_file_bytes: 100,
          },
        ],
        error: null,
      })),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ error: null })),
        })),
      },
      from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: null })) })),
    });

    const response = await POST(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "UPLOADED" });
  });

  it("denies a Guest before reading the Pending Upload", async () => {
    mocks.readProfileAccess.mockResolvedValue({ status: "guest" });
    const response = await POST(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("WF-UPLOAD-PARTICIPATION");
  });

  it("maps Storage failure without exposing backend text", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      userId: "10000000-0000-0000-0000-000000000003",
    });
    mocks.createServer.mockResolvedValue({});
    mocks.createAdmin.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: [
          {
            id,
            state: "CREATED",
            staging_key: "private/key.png",
            owner_id: "10000000-0000-0000-0000-000000000003",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            max_file_bytes: 100,
          },
        ],
        error: null,
      })),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({
            error: { message: "storage secret details" },
          })),
          download: vi.fn(async () => ({
            data: null,
            error: { message: "missing" },
          })),
        })),
      },
      from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: null })) })),
    });

    const response = await POST(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("storage secret details");
  });

  it("maps a Pending Upload database failure to a retryable response", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      userId: "10000000-0000-0000-0000-000000000003",
    });
    mocks.createServer.mockResolvedValue({});
    mocks.createAdmin.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: "database connection details" },
      })),
    });

    const response = await POST(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("WF-UPLOAD-DATABASE");
  });

  it("queues expired staging before returning a terminal response", async () => {
    mocks.readProfileAccess.mockResolvedValue({
      status: "active",
      userId: "10000000-0000-0000-0000-000000000003",
    });
    const rpc = vi.fn(async (name: string) =>
      name === "get_pending_upload_for_owner"
        ? {
            data: [
              {
                id,
                owner_id: "10000000-0000-0000-0000-000000000003",
                state: "CREATED",
                staging_key: "private/key.png",
                expires_at: new Date(Date.now() - 60_000).toISOString(),
                max_file_bytes: 100,
              },
            ],
            error: null,
          }
        : { data: [{ state: "EXPIRED" }], error: null },
    );
    const upsert = vi.fn(async () => ({ error: null }));
    mocks.createServer.mockResolvedValue({});
    mocks.createAdmin.mockReturnValue({
      rpc,
      from: vi.fn(() => ({ upsert })),
      storage: { from: vi.fn() },
    });

    const response = await POST(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(410);
    expect((await response.json()).error.code).toBe("WF-UPLOAD-EXPIRED");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ object_key: "private/key.png" }),
      expect.anything(),
    );
  });

  describe("duplicate staging retries", () => {
    function pngBytes(tail: number): ArrayBuffer {
      const out = new ArrayBuffer(5);
      new Uint8Array(out).set([0x89, 0x50, 0x4e, 0x47, tail]);
      return out;
    }

    function pngRequest(bytes: ArrayBuffer) {
      const body = new FormData();
      body.append(
        "file",
        new File([bytes], "wrap.png", { type: "image/png" }),
      );
      return new Request(
        "http://localhost/api/uploads/" + id + "/object",
        { method: "POST", body },
      );
    }

    function installDuplicateStorage(download: ReturnType<typeof vi.fn>) {
      const upsert = vi.fn(async () => ({ error: null }));
      mocks.readProfileAccess.mockResolvedValue({
        status: "active",
        userId: "10000000-0000-0000-0000-000000000003",
      });
      mocks.createServer.mockResolvedValue({});
      mocks.createAdmin.mockReturnValue({
        rpc: vi.fn(async () => ({
          data: [
            {
              id,
              state: "CREATED",
              staging_key: "private/key.png",
              owner_id: "10000000-0000-0000-0000-000000000003",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              max_file_bytes: 100,
            },
          ],
          error: null,
        })),
        storage: {
          from: vi.fn(() => ({
            upload: vi.fn(async () => ({ error: { message: "Duplicate" } })),
            download,
          })),
        },
        from: vi.fn(() => ({ upsert })),
      });
      return upsert;
    }

    it("completes idempotently when staged bytes match the retry", async () => {
      const staged = pngBytes(7);
      const upsert = installDuplicateStorage(
        vi.fn(async () => ({
          error: null,
          data: { arrayBuffer: async () => staged },
        })),
      );

      const response = await POST(pngRequest(staged), {
        params: Promise.resolve({ id }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ state: "UPLOADED" });
      expect(upsert).not.toHaveBeenCalled();
    });

    it("conflicts when staged bytes differ so a stale PNG cannot win", async () => {
      const staged = pngBytes(7);
      const upsert = installDuplicateStorage(
        vi.fn(async () => ({
          error: null,
          data: { arrayBuffer: async () => staged },
        })),
      );

      const response = await POST(pngRequest(pngBytes(9)), {
        params: Promise.resolve({ id }),
      });

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("WF-UPLOAD-STATE");
      expect(upsert).not.toHaveBeenCalled();
    });
  });
});
