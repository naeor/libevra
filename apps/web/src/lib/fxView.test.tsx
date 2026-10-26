import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { convertFx, type Transaction } from "@libellum/shared";
import { FxAmountView } from "../components/FxDisplay.js";
import { fxMoney, rangeMonths, readFxMode, saveFxMode, fxMonthCovered, fxMonthStored, mergeFxOriginals } from "./fxView.js";
import { applyLocale } from "../i18n/index.js";
const entry = { id: "synthetic", bookId: "b", kind: "expense", currency: "USD", amountCents: 2000, occurredLocalDate: "2026-10-23", categoryId: "c" } as unknown as Transaction;
describe("折算显示语义", () => {
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
