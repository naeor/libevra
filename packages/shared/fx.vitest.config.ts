import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({ root: fileURLToPath(new URL("../../", import.meta.url)), test: {
  environment: "node", fileParallelism: false,
  include: ["packages/shared/src/fx*.test.ts", "apps/api/src/fx/*.test.ts", "apps/web/src/lib/offline/fx.test.ts"],
} });
