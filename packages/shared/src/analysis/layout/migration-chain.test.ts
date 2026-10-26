/**
 * D-4 前置：版本迁移链（vN → vN+1）与投影缓存键测试。
 *
 * 当前工作台文档最新版本 = v1，注册表为空；这里用测试专用 TestDoc 证明链路语义
 * （identity / migrated / degraded / failed / read-only-newer），
 * 未来真实 v2 只需向 `LAYOUT_MIGRATION_STEPS` 追加一步纯函数。
 */

import { describe, expect, it } from "vitest";
import type { DocumentValidationResult } from "./validation.js";
import type { MigrationStep } from "./migration-chain.js";
import {
  CONTENT_MIGRATION_STEPS,
  LAYOUT_MIGRATION_STEPS,
  deriveProjectionCacheKey,
  migrateContentDocument,
  migrateLayoutDocument,
  readDeclaredSchemaVersion,
  runMigrationChain,
} from "./migration-chain.js";
import { analysisCard, contentOf, geometry, layoutOf, object } from "./test-support.js";

interface TestDoc {
  readonly schemaVersion: number;
  readonly payload: string;
}

function validateTestDoc(value: unknown): DocumentValidationResult<TestDoc> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, issues: [{ path: "$", code: "invalid-test-doc", detail: "不是对象" }] };
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (typeof record["schemaVersion"] !== "number" || !Number.isInteger(record["schemaVersion"])) {
    return { ok: false, issues: [{ path: "$.schemaVersion", code: "invalid-test-doc", detail: "schemaVersion 非法" }] };
  }
  if (typeof record["payload"] !== "string") {
    return { ok: false, issues: [{ path: "$.payload", code: "invalid-test-doc", detail: "payload 非法" }] };
  }
  return { ok: true, value: value as TestDoc };
}

function testDoc(schemaVersion: number, payload = "x"): TestDoc {
  return { schemaVersion, payload };
}

function bumpStep(from: number): MigrationStep<TestDoc> {
  return {
    from,
    to: from + 1,
    migrate: (value) => {
      const doc = value as TestDoc;
      return { ok: true, value: { schemaVersion: from + 1, payload: `${doc.payload}+${String(from + 1)}` } };
    },
  };
}

function failingStep(from: number): MigrationStep<TestDoc> {
  return {
    from,
    to: from + 1,
    migrate: () => ({ ok: false, issues: [{ path: "$", code: "step-broken", detail: "故意失败" }] }),
  };
}

const TARGET = 3;
const STEPS: readonly MigrationStep<TestDoc>[] = [bumpStep(1), bumpStep(2)];

describe("migration-chain：五种状态", () => {
  it("同版本 → identity，原样返回", () => {
    const doc = testDoc(3, "same");
    const result = runMigrationChain(doc, { steps: STEPS, targetVersion: TARGET, validate: validateTestDoc });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("identity");
    expect(result.value).toEqual(doc);
    expect(result.appliedSteps).toEqual([]);
  });

  it("旧版本 → 逐级 migrated，步骤记录完整", () => {
    const result = runMigrationChain(testDoc(1), { steps: STEPS, targetVersion: TARGET, validate: validateTestDoc });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("migrated");
    expect(result.appliedSteps).toEqual(["v1->v2", "v2->v3"]);
    expect(result.value?.payload).toBe("x+2+3");
    expect(result.value?.schemaVersion).toBe(3);
  });

  it("步骤失败 → degraded，保留迁移前最后一份合法文档", () => {
    const result = runMigrationChain(testDoc(1), {
      steps: [bumpStep(1), failingStep(2)],
      targetVersion: TARGET,
      validate: validateTestDoc,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("degraded");
    expect(result.value).toEqual(testDoc(2, "x+2"));
    expect(result.issues.map((item) => item.code)).toContain("migration-failed");
    expect(result.issues.map((item) => item.code)).toContain("step-broken");
  });

  it("缺少迁移步骤 → failed + missing-migration-step", () => {
    const result = runMigrationChain(testDoc(1), {
      steps: [bumpStep(1)],
      targetVersion: TARGET,
      validate: validateTestDoc,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.issues.map((item) => item.code)).toContain("missing-migration-step");
  });

  it("较新版本 → read-only-newer，绝不回写", () => {
    const result = runMigrationChain(testDoc(9), { steps: STEPS, targetVersion: TARGET, validate: validateTestDoc });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("read-only-newer");
    expect(result.issues.map((item) => item.code)).toContain("schema-newer-readonly");
    expect(result.appliedSteps).toEqual([]);
  });

  it("缺少 schemaVersion → failed", () => {
    const result = runMigrationChain({ payload: "x" }, { steps: STEPS, targetVersion: TARGET, validate: validateTestDoc });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("readDeclaredSchemaVersion 只接受整数", () => {
    expect(readDeclaredSchemaVersion({ schemaVersion: 2 })).toBe(2);
    expect(readDeclaredSchemaVersion({ schemaVersion: "2" })).toBeNull();
    expect(readDeclaredSchemaVersion({ schemaVersion: 1.5 })).toBeNull();
    expect(readDeclaredSchemaVersion(null)).toBeNull();
    expect(readDeclaredSchemaVersion([])).toBeNull();
  });
});

describe("migration-chain：工作台文档入口当前为 v1 identity", () => {
  const layout = layoutOf(geometry(2, [object("a", "analysis-card", 1, 1, 1)]));
  const content = contentOf([analysisCard("a")]);

  it("布局文档迁移入口 = identity + 严格校验", () => {
    expect(LAYOUT_MIGRATION_STEPS).toEqual([]);
    const result = migrateLayoutDocument(layout);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("identity");
    expect(result.value).toEqual(layout);
  });

  it("内容文档迁移入口 = identity + 严格校验", () => {
    expect(CONTENT_MIGRATION_STEPS).toEqual([]);
    const result = migrateContentDocument(content);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("identity");
    expect(result.value).toEqual(content);
  });

  it("损坏布局文档迁移失败但不抛异常", () => {
    const result = migrateLayoutDocument({ schemaVersion: 1, mode: "unified", main: { baseCols: 0, objects: [] } });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe("migration-chain：投影缓存键派生（实现约定，不进冻结契约）", () => {
  const base = {
    layoutVersion: 3,
    contentVersion: 2,
    layoutAlgorithmVersion: 1,
    targetColumns: 4,
    constraintsVersion: "w3-alpha",
  } as const;

  it("同输入同输出，默认策略 size-first 写入键", () => {
    const key = deriveProjectionCacheKey(base);
    expect(key).toBe(deriveProjectionCacheKey(base));
    expect(key).toContain("strategy=size-first");
    expect(key).toContain("cols=4");
  });

  it("任一输入变化都会得到不同键", () => {
    const key = deriveProjectionCacheKey(base);
    expect(deriveProjectionCacheKey({ ...base, targetColumns: 3 })).not.toBe(key);
    expect(deriveProjectionCacheKey({ ...base, layoutVersion: 4 })).not.toBe(key);
    expect(deriveProjectionCacheKey({ ...base, contentVersion: 3 })).not.toBe(key);
    expect(deriveProjectionCacheKey({ ...base, constraintsVersion: "w3-beta" })).not.toBe(key);
    expect(deriveProjectionCacheKey({ ...base, strategy: "position-first" })).not.toBe(key);
  });
});
