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
