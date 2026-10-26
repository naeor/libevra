import "dotenv/config";
import { defineConfig, env } from "prisma/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  schema: fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)),
  migrations: { path: fileURLToPath(new URL("../_backups/unified/baseline-migrations", import.meta.url)) },
  datasource: { url: env("DATABASE_URL") },
});
