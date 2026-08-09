import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: "workspace-alias",
      resolveId(source) {
        return source.startsWith("@/")
          ? `${resolve(workspaceRoot, source.slice(2))}.ts`
          : undefined;
      },
    },
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
