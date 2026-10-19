import { describe, expect, it } from "vitest";

import { recordCriticalEvent } from "../src/critical/store.js";
import { prisma, resetDatabase } from "./support.js";

describe("S13-I local capacity/performance sanity", () => {
  it("appends many events without superlinear degradation in the test database", async () => {
    await resetDatabase();
    const count = 300;
    const started = performance.now();
    for (let index = 0; index < count; index += 1) {
      await prisma.$transaction((tx) =>
        recordCriticalEvent(tx, {
          type: "book.created",
          subjectType: "system",
          subjectId: `bulk-${String(index)}`,
          afterState: { index },
        }),
      );
    }
    const elapsedMs = performance.now() - started;
    const rows = await prisma.criticalEvent.count();
    const chain = await prisma.criticalChain.findUniqueOrThrow({ where: { id: "global" } });
    const size = await prisma.$queryRaw<{ bytes: bigint }[]>`
      SELECT pg_total_relation_size('critical_events') AS bytes
    `;
    console.log(
      `S13I_CAPACITY events=${String(rows)} elapsedMs=${elapsedMs.toFixed(1)} avgMs=${(elapsedMs / count).toFixed(2)} bytes=${String(size[0]?.bytes ?? 0n)}`,
    );
    expect(rows).toBe(count);
    expect(chain.lastSeq).toBe(count);
    expect(elapsedMs / count).toBeLessThan(100);
  }, 60_000);
});
