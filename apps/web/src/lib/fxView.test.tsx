import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aggregateFx, convertFx, type Transaction } from "@libellum/shared";
import { FxAmountView, FxMonthSummary } from "../components/FxDisplay.js";
import { fxMoney, rangeMonths, readFxMode, saveFxMode, fxMonthCovered, fxMonthStored, mergeFxOriginals } from "./fxView.js";
import { applyLocale } from "../i18n/index.js";
import type { useFxRange } from "./fxView.js";
const entry = { id: "synthetic", bookId: "b", kind: "expense", currency: "USD", amountCents: 2000, occurredLocalDate: "2026-10-23", categoryId: "c" } as unknown as Transaction;
describe("折算显示语义", () => {
  it("综合主卡保留超大金额和负差额，沿用逐笔汇总值", () => {
    applyLocale("zh-CN");
    const result = aggregateFx("a", "b", [{ ...entry, bookId: "b", currency: "CNY", amountCents: 1000000000000 }], "CNY", new Map());
    const data = { target: "CNY", result, sourceComplete: true, refresh: () => {} } as unknown as ReturnType<typeof useFxRange>;
    const html = renderToStaticMarkup(<FxMonthSummary data={data} />);
    expect(html).toContain("10,000,000,000.00 CNY");
    expect(html).toContain("−10,000,000,000.00 CNY");
    expect(html).toContain("收支差额");
    expect(html).not.toContain("统计不完整");
  });
  it("缺汇率和原件不完整分别保留小计提醒，不能伪装完整总额", () => {
    applyLocale("zh-CN");
    const missing = aggregateFx("a", "b", [{ ...entry, bookId: "b" }], "CNY", new Map());
    const identity = aggregateFx("a", "b", [{ ...entry, bookId: "b" }], "USD", new Map());
    for (const [result, target, sourceComplete] of [[missing, "CNY", true], [identity, "USD", false]] as const) {
      const data = { target, result, sourceComplete, refresh: () => {} } as unknown as ReturnType<typeof useFxRange>;
      expect(renderToStaticMarkup(<FxMonthSummary data={data} />)).toContain("成功折算部分的小计");
    }
  });
  it("整数字符串金额不丢精度，JPY 不放大100倍", () => {
    expect(fxMoney("18014398509481982", "CNY")).toBe("180,143,985,094,819.82 CNY");
    expect(fxMoney("1500", "JPY")).toBe("1,500 JPY");
  });
  it("缺失时保留原币，不能显示伪造零元", () => {
    applyLocale("zh-CN");
    const result = convertFx({ ...entry, bookId: "b" }, "CNY");
    const html = renderToStaticMarkup(<FxAmountView entry={entry} target="CNY" result={result} loading={false} />);
    expect(html).toContain("20.00 USD"); expect(html).toContain("汇率不可用"); expect(html).not.toContain("0.00 CNY");
  });
  it("同币种没有重复原币或来源说明", () => {
    const result = convertFx({ ...entry, bookId: "b" }, "USD");
    const html = renderToStaticMarkup(<FxAmountView entry={entry} target="USD" result={result} loading={false} details />);
    expect(html).not.toContain("原币"); expect(html).not.toContain("ECB");
  });
  it("未知账号默认关闭；月份边界有界", () => {
    expect(readFxMode("")).toBe(false); expect(saveFxMode("", true)).toBe(false);
    expect(rangeMonths("2025-12-20", "2026-02-01")).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(() => rangeMonths("2000-01-01", "2026-01-01")).toThrow();
  });
  it("五万笔完整性核对与缺项检查不需要双重扫描", () => {
    const rows = Array.from({ length: 50000 }, (_, index) => ({ ...entry, id: String(index), version: 1 }));
    expect(fxMonthStored(rows, rows)).toBe(true);
    expect(fxMonthCovered(rows.map(row => row.id), rows.slice(1))).toBe(false);
    expect(fxMonthStored([{ ...rows[0]!, version: 2 }], rows)).toBe(false);
  });
  it("在线原件合并保留待同步新建/编辑，但不复活服务器已删除的旧账", () => {
    const remote = { ...entry, id: "remote", amountCents: 100, version: 1 };
    const edited = { ...remote, amountCents: 200, version: 2 };
    const localNew = { ...entry, id: "pending-new", version: 1 };
    const oldDeleted = { ...entry, id: "server-removed", version: 1 };
    const rows = mergeFxOriginals([remote], [edited, localNew, oldDeleted], { remote: { pending: true }, "pending-new": { pending: true } });
    expect(rows.map(row => row.id).sort()).toEqual(["pending-new", "remote"]);
    expect(rows.find(row => row.id === "remote")?.amountCents).toBe(200);
    expect(remote.amountCents).toBe(100);
  });
});
