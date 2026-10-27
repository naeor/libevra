import { aggregateFx, type FxEntry, type Transaction } from "@libellum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { applyLocale } from "../i18n/index.js";
import { CardBody } from "./cards.js";
import { agentAResult, timeSeriesFor } from "./compute.js";
import { newCard } from "./defaults.js";
import { fxResultBridge, originalCompleteness, timeResultBridge } from "./results.js";
import type { FxRangeView, WorkbenchScope } from "./scope.js";

const range = { from: "2026-10-01", to: "2026-10-23" };
const fxEntry: FxEntry = { id: "one", bookId: "b", amountCents: 1200, currency: "CNY", occurredLocalDate: "2026-10-20", kind: "expense", categoryId: "c" };
const transaction = { ...fxEntry, categoryName: "餐饮", categoryIsSystem: false, paymentMethodId: null, paymentMethodName: null, occurredAt: "2026-10-20T12:00:00Z", occurredTz: "Asia/Shanghai", note: null, tags: [], version: 1 } as Transaction;
const success = aggregateFx("a", "b", [fxEntry], "CNY", new Map());
const completeFx = { target: "CNY", result: success, sourceComplete: true, loading: false, refresh: () => {} } as unknown as FxRangeView;
function scope(overrides: Partial<WorkbenchScope> = {}): WorkbenchScope {
  return { today: "2026-10-27", filters: { time: { kind: "preset", preset: "30d" }, currency: null, combined: true }, range, bucket: "day", combined: true, fxAvailable: true, currency: "CNY", defaultCurrency: "CNY", entries: [transaction], loaded: true, fx: completeFx, coverageGap: null, repairing: false, accountScope: "user:a", ...overrides };
}

describe("W2/W3公共元数据桥接（不冒充完整shape投影）", () => {
  it("FX金额载荷保持同一引用，七卡复用A目录与冻结元数据", () => {
    for (const id of ["AN-B01", "AN-B02", "AN-B03", "AN-I01", "AN-I02", "AN-I03", "AN-I04"]) {
      const bridge = fxResultBridge(id, scope());
      expect(bridge.nativeResult).toBe(success);
      expect(bridge.metadata.version).toBe("s01-v2");
      expect(bridge.metadata.resolvedCurrency).toEqual({ mode: "aggregate", targetCurrency: "CNY" });
      expect(bridge.metadata.computation.fxPolicy).toBe("minor-half-away-v1");
      expect(bridge.metadata.source.query.currency).toBeNull();
      expect(bridge.metadata.completeness).toBe("complete");
      expect(bridge).not.toHaveProperty("shape");
    }
  });

  it("FX加载、读取失败、权限失败、覆盖缺失、汇率缺失、空时段明确区分", () => {
    const missing = aggregateFx("a", "b", [{ ...fxEntry, currency: "USD" }], "CNY", new Map());
    const cases = [
      [{ loading: true, result: undefined }, "loading"],
      [{ error: true, result: undefined }, "request-failed"],
      [{ error: true, reason: "permission", result: undefined }, "no-permission"],
      [{ sourceComplete: false }, "offline-incomplete"],
      [{ result: missing }, "fx-incomplete"],
      [{ result: aggregateFx("a", "b", [], "CNY", new Map()) }, "no-transactions"],
    ] as const;
    for (const [overrides, state] of cases) {
      const bridge = fxResultBridge("AN-B01", scope({ fx: { ...completeFx, ...overrides } as FxRangeView }));
      expect(bridge.metadata.completeness).toBe(state);
      if (state !== "no-transactions") expect(bridge.metadata.unavailableReason).toBeTruthy();
    }
    expect(fxResultBridge("AN-B01", scope(), { ...range, from: "2026-09-01" }).metadata.completeness).toBe("not-applicable");
  });

  it("B桶状态不改写，未知覆盖与进行中状态按冻结九态呈现", () => {
    const original = scope({ combined: false, fx: null });
    const native = timeSeriesFor(original.entries, "expense", "day", range, original.today);
    const bridge = timeResultBridge("AN-I06", native, native.result, original, range, { metric: "expense", kind: "expense", groupBy: "day" });
    expect(bridge.nativeResult).toBe(native);
    expect(bridge.metadata.completeness).toBe("complete");
    expect(timeResultBridge("AN-I06", native, { complete: false, unknownBucketCount: 1 }, original, range, { metric: "expense", kind: "expense", groupBy: "day" }).metadata.completeness).toBe("offline-incomplete");
    expect(timeResultBridge("AN-I06", native, { complete: false, inProgressBucketCount: 1 }, original, range, { metric: "expense", kind: "expense", groupBy: "day" }).metadata.completeness).toBe("partial");
    expect(bridge.metadata.resolvedCurrency).toEqual({ mode: "original", currency: "CNY" });
    for (const state of ["no-permission", "request-failed"] as const) {
      const blocked = timeResultBridge("AN-I06", native, native.result, { ...original, rangeReadState: state }, range, { metric: "expense", kind: "expense", groupBy: "day" });
      expect(blocked.metadata.completeness).toBe(state);
      expect(blocked.metadata.unavailableReason).toBeTruthy();
      const html = renderToStaticMarkup(<CardBody card={newCard("AN-I06")} scope={{ ...original, rangeReadState: state }} density="expanded" />);
      expect(html).not.toContain("¥0.00");
      expect(html).not.toContain("正在读取");
    }
    expect(timeResultBridge("AN-A01", native, { complete: true }, original, range, { metric: "income-expense", kind: "both", groupBy: null }, false, false).metadata).toMatchObject({ completeness: "offline-incomplete", unavailableReason: "comparison-previous-range-unverified" });
  });

  it("原币固定区间和自带窗口没有独立覆盖证明时不标完整，A/B页面实际显示提示", () => {
    applyLocale("zh-CN");
    const original = scope({ combined: false, fx: null });
    const pinned = { from: "2026-09-01", to: "2026-10-23" };
    expect(originalCompleteness(original, pinned)).toBe("offline-incomplete");
    const result = agentAResult(original.entries, "AN-I01", pinned, "CNY", original.today, "offline-incomplete", "local-range-coverage-unverified");
    expect(result.completeness).toBe("offline-incomplete");
    if (result.shape === "composition") {
      expect(result.total).toBeNull();
      expect(result.parts.every(part => part.share === null)).toBe(true);
    }
    for (const id of ["AN-B01", "AN-I01", "AN-I06", "AN-I11", "AN-I12", "AN-I20", "AN-A01"]) {
      const card = { ...newCard(id), rangePolicy: "pinned" as const, pinnedRange: id === "AN-I12" ? { from: "2026-09-01", to: "2026-09-23" } : pinned };
      const html = renderToStaticMarkup(<CardBody card={card} scope={original} density="expanded" />);
      expect(html, id).toContain("数据不完整");
    }
    const ownWindow = renderToStaticMarkup(<CardBody card={newCard("AN-I09")} scope={original} density="expanded" />);
    expect(ownWindow).toContain("数据不完整");
  });

  it("FX权限失败与全缺汇率在正式卡片中不显示伪造零金额", () => {
    applyLocale("zh-CN");
    const noPermission = renderToStaticMarkup(<CardBody card={newCard("AN-B01")} scope={scope({ fx: { ...completeFx, result: undefined, error: true, reason: "permission" } as unknown as FxRangeView })} density="medium" />);
    expect(noPermission).toContain("无权访问该账本");
    expect(noPermission).not.toContain("¥0.00");
    const missing = aggregateFx("a", "b", [{ ...fxEntry, currency: "USD" }], "CNY", new Map());
    const html = renderToStaticMarkup(<CardBody card={newCard("AN-I01")} scope={scope({ fx: { ...completeFx, result: missing } })} density="expanded" />);
    expect(html).toContain("无法确定");
    expect(html).not.toContain("这段时间没有记录");
    const empty = aggregateFx("a", "b", [], "CNY", new Map());
    const noTransactions = renderToStaticMarkup(<CardBody card={newCard("AN-B01")} scope={scope({ fx: { ...completeFx, result: empty } })} density="medium" />);
    expect(noTransactions).toContain("这段时间没有记录");
    expect(noTransactions).not.toContain("¥0.00");
  });
});
