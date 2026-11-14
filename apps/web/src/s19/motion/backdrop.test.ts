import { describe, expect, it } from "vitest";
import { PaneHistory, entryFromPath } from "../../workspace/paneHistory.js";
import { BackdropStore, directionFor, type VisualScope } from "./backdrop.js";

const scope: VisualScope = { workspace: "w1", account: "u1", ledger: "b1", style: "b2" };
const edges = [["A", "C"], ["B", "C"], ["C", "D"]] as const;
describe("视觉上下文只消费真实历史身份", () => {
  it("A→C 与 B→C 分离；B→C→D→C 恢复原描述与滚动，不继承 D", () => {
    const store = new BackdropStore();
    const a = store.ensure("a", "A", scope, undefined, "source");
    const b = store.ensure("b", "B", scope, undefined, "source");
    const ca = store.ensure("ca", "C", scope, a, "source");
    const cb = store.ensure("cb", "C", scope, b, "source");
    cb.scroll = 640;
    const saved = structuredClone(cb);
    const d = store.ensure("d", "D", scope, cb, "source");
    expect(ca.ambient).not.toEqual(cb.ambient);
    expect(d.sourceScene).toMatchObject({ page: "C", scroll: 640, ambient: cb.ambient });
    expect(store.ensure("cb", "C", scope, d, "source")).toEqual(saved);
    expect(directionFor(cb, d, "PUSH", edges, true)).toBe("push");
    expect(directionFor(d, cb, "POP", edges, true)).toBe("pop");
    expect(directionFor(d, cb, "POP", edges, false)).toBe("none");
    expect(directionFor(cb, ca, "POP", edges, true)).toBe("none");
  });
  it("不把相同 URL、replace、未知 POP 与主 Tab 切换当成已授权关系", () => {
    const store = new BackdropStore();
    const a = store.ensure("a", "A", scope, undefined, "source");
    const c = store.ensure("c", "C", scope, undefined, "source");
    expect(directionFor(a, c, "PUSH", edges, true)).toBe("none");
    const known = store.ensure("c2", "C", scope, a, "source");
    expect(directionFor(a, known, "REPLACE", edges, true)).toBe("none");
    expect(directionFor(a, known, "POP", edges, true)).toBe("none");
    expect(directionFor(a, known, "PUSH", [], true)).toBe("none");
  });
  it("1.19.75 T3：REPLACE 换出的新记录接过被替换记录的来源，之后返回照常授权；指向旧记录的来源改指新记录", () => {
    const store = new BackdropStore();
    const me = store.ensure("me", "A", scope, undefined, "source");
    const profile = store.ensure("p1", "C", scope, me, "source");
    // 个人资料「编辑」：同一路径 replace 成新 key。
    const edited = store.replace(profile, "p2", "C", scope);
    expect(edited.sourceKey).toBe("me");
    expect(edited.sourceScene).toMatchObject({ page: "A" });
    expect(directionFor(edited, me, "POP", edges, true)).toBe("pop");
    // 已经认识的 key 不重建。
    expect(store.replace(profile, "p2", "C", scope)).toBe(edited);
    // 前进栈里以旧记录为来源的页面改指新记录：从它返回到新记录仍授权。
    const child = store.ensure("d1", "D", scope, edited, "source");
    const again = store.replace(edited, "p3", "C", scope);
    expect(child.sourceKey).toBe("p3");
    expect(directionFor(child, again, "POP", edges, true)).toBe("pop");
    // 换了页面的 replace（账本详情切换账本）同样接过来源；返回仍要求那条边本身合法。
    const switched = store.replace(again, "b1", "B", scope);
    expect(switched.sourceKey).toBe("me");
    expect(directionFor(switched, me, "POP", edges, true)).toBe("none");
    // 本来没有来源（深链第一页）就仍然没有。
    const deep = store.ensure("deep", "C", scope, undefined, "source");
    expect(store.replace(deep, "deep2", "C", scope).sourceKey).toBeNull();
  });
  it("1.19.75 T2：协调器的作用域不含风格，换风格不清空关系；换账号 / 账本 / 工作区仍彻底清理", () => {
    const store = new BackdropStore();
    const base: VisualScope = { workspace: "w1", account: "u1", ledger: "b1" };
    const a = store.ensure("a", "A", base, undefined, "source");
    const c = store.ensure("c", "C", base, a, "source");
    // pilot.tsx 的 scope() 只由工作区、账号、账本组成：改风格 / 明暗 / 配色前后是同一个作用域。
    expect(store.setScope({ ...base })).toBe(false);
    expect(store.get("c")?.sourceKey).toBe("a");
    expect(directionFor(c, a, "POP", edges, true)).toBe("pop");
    expect(store.setScope({ ...base, ledger: "b2" })).toBe(true);
    expect(store.size).toBe(0);
  });
  it("导航截断删除前进条目的描述；无限导航仍有界；切换身份彻底清理", () => {
    const history = new PaneHistory("w1", [entryFromPath("/A", "a")]);
    const store = new BackdropStore();
    let current = store.ensure("a", "A", scope, undefined, "source");
    for (let i = 0; i < 100; i++) {
      history.push(`/C?i=${i}`);
      current = store.ensure(history.location.key, "C", scope, current, "source");
    }
    expect(store.size).toBe(64);
    const discarded = current.entryKey;
    history.go(-1); history.push("/D");
    store.prune(history.serialize().entries.map(entry => entry.key));
    expect(store.get(discarded)).toBeUndefined();
    for (const next of [{ ...scope, ledger: "b2" }, { ...scope, account: "u2" }, { ...scope, workspace: "w2" }, { ...scope, style: "a" }]) {
      store.setScope(next); expect(store.size).toBe(0);
      store.ensure("same-key", "A", next, undefined, "source");
    }
    // 视觉层未改业务历史。
    expect(history.location.pathname).toBe("/D");
  });
});
