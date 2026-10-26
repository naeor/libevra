import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const main = resolve(root, "../记账程序v1");
const git = (cwd, ...args) => execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd, encoding: "utf8" }).trim();
const mainHead = git(main, "rev-parse", "HEAD");
const base = git(root, "merge-base", "HEAD", mainHead);
const hash = value => createHash("sha256").update(value).digest("hex");
const files = ["prisma/schema.prisma", "packages/shared/src/index.ts", "packages/shared/src/ledger.ts", "packages/shared/src/money.ts", "packages/shared/src/auth.ts",
  "apps/web/src/i18n/sharedMessages.test.ts", "apps/web/src/lib/offline/storage.ts", "apps/web/src/lib/offline/scope.ts", "apps/web/src/lib/offline/writePolicy.ts",
  "apps/api/src/ledger/access.ts", "apps/api/src/auth/guard.ts", "apps/api/src/admin/guard.ts", "apps/api/src/admin/rules.ts"];
const checked = files.filter(file => existsSync(resolve(main, file))).map(file => {
  const original = hash(git(root, "show", `${base}:${file}`));
  const latest = hash(readFileSync(resolve(main, file), "utf8").trim());
  return { file, mainChangedSinceBase: original !== latest, mainSha256: latest };
});
const migrations = readdirSync(resolve(main, "prisma/migrations"), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
const ourFiles = new Set(git(root, "diff", "--name-only", base, "HEAD").split("\n"));
const mainFiles = new Set([...git(main, "diff", "--name-only", base, "HEAD").split("\n"), ...git(main, "diff", "--name-only").split("\n")]);
const overlap = [...ourFiles].filter(file => mainFiles.has(file));
const output = { checkedAt: new Date().toISOString(), base, mainHead, migrations: { count: migrations.length, latest: migrations.at(-1), changed: git(main, "diff", "--name-only", base, "--", "prisma/migrations") }, checked, overlappingFiles: overlap, mainWorkingFiles: git(main, "status", "--short") };
mkdirSync(resolve(root, "_backups/fx-preintegration"), { recursive: true });
writeFileSync(resolve(root, "_backups/fx-preintegration/audit.json"), JSON.stringify(output, null, 2) + "\n");
writeFileSync(resolve(root, "_backups/fx-preintegration/schema.prisma"), readFileSync(resolve(main, "prisma/schema.prisma"), "utf8") + "\n" + readFileSync(resolve(root, "prisma/pending/s16-d/models.prisma"), "utf8"));
console.log(JSON.stringify(output, null, 2));
