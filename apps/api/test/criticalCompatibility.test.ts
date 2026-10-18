import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "..", "..");

describe("S13-I raw backup independence", () => {
  it("keeps the existing restore/backup path free of S13-I dependencies", () => {
    const restore = readFileSync(join(root, "deploy/restore.sh"), "utf8");
    const backup = readFileSync(join(root, "deploy/backup.sh"), "utf8");
    const backupAll = readFileSync(join(root, "deploy/backup-all.sh"), "utf8");
    for (const script of [restore, backup, backupAll]) {
      expect(script).not.toMatch(/critical[_-]?events?/i);
      expect(script).not.toMatch(/CRITICAL_EVENT/);
    }
    const emergency = readFileSync(join(root, "deploy/emergency-raw-restore.sh"), "utf8");
    expect(emergency).not.toMatch(/critical_events/);
    expect(emergency).not.toMatch(/critical:relay/);
    expect(emergency).toContain("api web");
  });
});
