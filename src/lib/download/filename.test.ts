import { describe, expect, it } from "vitest";

import { safeDownloadFilename } from "./filename";

describe("safeDownloadFilename", () => {
  it("slugifies a plain title, preserving original casing", () => {
    expect(safeDownloadFilename("Midnight Chrome Wrap")).toBe(
      "Midnight-Chrome-Wrap.png",
    );
  });

  it("strips non-ASCII characters before slugging", () => {
    const name = safeDownloadFilename("Crème Brûlée Finish");
    expect(name).toMatch(/^[A-Za-z0-9-]+\.png$/);
  });

  it("collapses runs of separators into one dash", () => {
    expect(safeDownloadFilename("  acid   green -- wrap! ")).toBe(
      "acid-green-wrap.png",
    );
  });

  it("caps the base at twenty-six characters", () => {
    const name = safeDownloadFilename("a".repeat(60));
    expect(name).toBe("a".repeat(26) + ".png");
  });

  it("falls back to wrap when nothing survives", () => {
    expect(safeDownloadFilename("///")).toBe("wrap.png");
  });
});
