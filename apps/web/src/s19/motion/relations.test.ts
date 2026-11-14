import { describe, expect, it } from "vitest";
import { directionFor, type VisualScope } from "./backdrop.js";
import { inheritReplace, motionRelations } from "./relations.js";
import type { ObjectSource } from "./objectExpand.js";

const scope: VisualScope = { workspace: "w1", account: "u1", ledger: "b1" };
const card: ObjectSource = { id: "/transactions/1", rect: { x: 0, y: 100, width: 300, height: 60 }, width: 390, height: 844, radius: 16, safeTop: 0, safeBottom: 780 };

describe("转场关系跟着历史走，不跟着外观走（1.19.75）", () => {
  it("T2：协调器因换风格重建时拿到同一份关系，来源、对象展开、工作区来源与滚动都还在", () => {
    const history = {};
    const first = motionRelations(history, scope);
    const me = first.store.ensure("me", "/me", scope, undefined, "source");
    first.store.ensure("settings", "/settings", scope, me, "source");
    first.objectEntries.set("detail", { source: card, sourceKey: "ledger" });
    first.modeEntries.set("add", "ledger");
    first.scrolls.set("me", { documentY: 0, inner: [320] });
    // 改风格：pilot.tsx 的 effect 依赖里有风格，旧协调器 dispose、新协调器 createPilot——作用域（工作区 / 账号 / 账本）没变。
    const second = motionRelations(history, { ...scope });
    expect(second).toBe(first);
    const settings = second.store.get("settings")!;
    expect(settings.sourceKey).toBe("me");
    expect(directionFor(settings, second.store.get("me")!, "POP", [["/me", "/settings"]], true)).toBe("pop");
    expect(second.objectEntries.get("detail")?.sourceKey).toBe("ledger");
    expect(second.modeEntries.get("add")).toBe("ledger");
    expect(second.scrolls.get("me")?.inner).toEqual([320]);
  });

  it("换账号、换账本或另一个工作区：重新开始，不把别人的来源带过去", () => {
    const history = {};
    const first = motionRelations(history, scope);
    first.store.ensure("me", "/me", scope, undefined, "source");
    for (const next of [{ ...scope, ledger: "b2" }, { ...scope, account: "u2" }]) {
      const fresh = motionRelations(history, next);
      expect(fresh).not.toBe(first);
      expect(fresh.store.size).toBe(0);
      expect(fresh.objectEntries.size).toBe(0);
    }
    // 另一条历史（另一个工作区实例）各有各的关系。
    expect(motionRelations({}, scope)).not.toBe(motionRelations(history, scope));
  });

  it("T3：同一路径 replace 也接过对象展开与记账工作区的来源；换了页面只接默认次级导航的来源", () => {
    const relations = motionRelations({}, scope);
    const ledger = relations.store.ensure("ledger", "/", scope, undefined, "source");
    const detail = relations.store.ensure("detail", "/transactions/1", scope, undefined, "source");
    relations.objectEntries.set("detail", { source: card, sourceKey: "ledger" });
    // 同一路径换查询参数：收回到同一张卡片。
    const same = inheritReplace(relations, detail, "detail2", "/transactions/1", scope);
    expect(relations.objectEntries.get("detail2")).toEqual({ source: card, sourceKey: "ledger" });
    expect(same.entryKey).toBe("detail2");
    // 换成另一页：原来那张卡片已经不是它的来源。
    inheritReplace(relations, same, "other", "/transactions/2", scope);
    expect(relations.objectEntries.has("other")).toBe(false);

    const scan = relations.store.ensure("scan", "/scan", scope, undefined, "source");
    relations.modeEntries.set("scan", "ledger");
    inheritReplace(relations, scan, "scan2", "/scan", scope);
    expect(relations.modeEntries.get("scan2")).toBe("ledger");

    // 被替换的是来源页本身（明细换筛选）：以它为来源的记录改指新记录。
    relations.objectEntries.set("detail3", { source: card, sourceKey: "ledger" });
    relations.modeEntries.set("add", "ledger");
    inheritReplace(relations, ledger, "ledger2", "/", scope);
    expect(relations.objectEntries.get("detail3")?.sourceKey).toBe("ledger2");
    expect(relations.modeEntries.get("add")).toBe("ledger2");
  });
});
