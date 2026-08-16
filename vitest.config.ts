import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: "workspace-alias",
      resolveId(source) {
        if (source === "server-only") return "\0server-only";
        return source.startsWith("@/")
          ? `${resolve(workspaceRoot, "src", source.slice(2))}.ts`
          : undefined;
      },
      load(id) {
        return id === "\0server-only" ? "export default undefined;" : undefined;
      },
    },
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
