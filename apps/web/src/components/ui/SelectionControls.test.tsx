import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NAVIGATION, SELECTION_GLIDE, selectionGlideDuration } from "../../lib/motionTokens.js";
import { SegmentedControl } from "./PurposeControls.js";
import { ConditionTag, ConditionTags, MovingSelection, SelectionGrid, SelectionItem, ToggleButton } from "./SelectionControls.js";
import { focusAfterRemoval, glideFrames, reconcileTags, selectionMotion, selectionStyle, slideFrames, type ConditionTagEntry, type ConditionTagItem } from "./selectionModel.js";

/**
 * 选中指示与已选条件标签（1.19.62，S19 §3）。本仓库没有 jsdom：风格分支、关键帧、标签状态与焦点去向是纯函数，
 * 结构与无障碍属性用静态渲染检查，外观与减少动态效果用 CSS 源码检查（与 ChoiceSheet.test.tsx 同一做法）。
 */
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const root = (themeMode?: string, visualStyle?: string) => ({ dataset: { ...(themeMode ? { themeMode } : {}), ...(visualStyle ? { visualStyle } : {}) } as DOMStringMap });

describe("风格分支", () => {
  it("只在浅色、带 S19 作用域标记的外壳里按四种风格走；Original、深色、Pad / 电脑版回落基础外观", () => {
    for (const style of ["a", "b1", "b2", "c"] as const) expect(selectionStyle(root("light", style), true)).toBe(style);
    expect(selectionStyle(root("dark", "b2"), true)).toBeNull();
    expect(selectionStyle(root("light"), true)).toBeNull(); // Original：根上没有 data-visual-style
    expect(selectionStyle(root("light", "b1"), false)).toBeNull(); // 不在作用域里（Pad 宽屏、电脑版）
    expect(selectionStyle(root("light", "x"), true)).toBeNull();
  });

  it("B1 / B2 弹性玻璃、C 干脆滑动、A 不移动色块；基础外观只有原滑动胶囊才移动；减少动态效果一律直接切换", () => {
    expect(selectionMotion("b1", "static", false)).toBe("glide");
    expect(selectionMotion("b2", "slide", false)).toBe("glide");
    expect(selectionMotion("c", "static", false)).toBe("slide");
    expect(selectionMotion("a", "slide", false)).toBe("none");
    expect(selectionMotion(null, "slide", false)).toBe("base");
    expect(selectionMotion(null, "static", false)).toBe("none");
    // 1.19.67：SlidingSelection 的基础外观（复制选中样式的原滑动胶囊）与 slide 同一节奏；S19 下与其他调用方完全相同。
    expect(selectionMotion(null, "copy", false)).toBe("base");
    for (const style of ["b1", "b2"] as const) expect(selectionMotion(style, "copy", false)).toBe("glide");
    expect(selectionMotion("c", "copy", false)).toBe("slide");
    expect(selectionMotion("a", "copy", false)).toBe("none");
    expect(selectionMotion(null, "copy", true)).toBe("none");
    for (const style of ["a", "b1", "b2", "c", null] as const) expect(selectionMotion(style, "slide", true)).toBe("none");
  });
});

describe("会移动的选中：关键帧", () => {
  const nav = [{ x: 4, y: 8, width: 88, height: 48 }, { x: 4, y: 108, width: 88, height: 48 }] as const;
  const seg = [{ x: 0, y: 0, width: 56, height: 44 }, { x: 60, y: 0, width: 88, height: 44 }] as const;

  it("B1 / B2 竖向：起点是来时的位置，终点精确贴合目标；途中沿移动方向拉长、越过目标再回弹，宽度不变", () => {
    const [from, to] = nav;
    const { frames, duration } = glideFrames(from, to, "y");
    expect(frames[0]).toMatchObject({ offset: 0, transform: "translate3d(4px, 8px, 0)", height: "48px", width: "88px" });
    expect(frames.at(-1)).toMatchObject({ offset: 1, transform: "translate3d(4px, 108px, 0)", height: "48px", width: "88px" });
    const heights = frames.map(frame => parseFloat(String(frame.height)));
    expect(Math.max(...heights)).toBeGreaterThan(48);
    expect(Math.max(...heights)).toBeLessThanOrEqual(48 * (1 + SELECTION_GLIDE.maxStretch) + 1e-9);
    expect(frames.every(frame => frame.width === "88px" && !String(frame.transform).includes("scale"))).toBe(true);
    // 越过：0.72 那一帧的中心在目标中心之下。
    const over = frames.find(frame => frame.offset === SELECTION_GLIDE.offsets.over)!;
    const top = Number(/translate3d\([^,]+, ([-\d.]+)px/.exec(String(over.transform))![1]);
    expect(top + parseFloat(String(over.height)) / 2).toBeGreaterThan(to.y + to.height / 2);
    expect(duration).toBe(selectionGlideDuration(100));
  });

  it("B1 / B2 横向（分段）：宽度不同也贴合，反方向同样成立；动画途中的位置可以作为起点", () => {
    for (const [from, to] of [[seg[0], seg[1]], [seg[1], seg[0]]] as const) {
      const { frames } = glideFrames(from, to, "x");
      expect(frames.at(-1)).toMatchObject({ transform: `translate3d(${to.x}px, 0px, 0)`, width: `${to.width}px`, height: "44px" });
    }
    const midway = { x: 31.5, y: 0, width: 70.25, height: 44 };
    expect(glideFrames(midway, seg[0], "x").frames[0]).toMatchObject({ transform: "translate3d(31.5px, 0px, 0)", width: "70.25px" });
  });

  it("与底栏选中胶囊同一套时长：190–270ms × 1.08（原 tabIndicator 公式）", () => {
    for (const distance of [0, 20, 100, 250, 600]) {
      expect(selectionGlideDuration(distance)).toBe(Math.round(Math.min(270, Math.max(190, 150 + distance * 0.4)) * 1.08));
      expect(selectionGlideDuration(distance, 210)).toBe(Math.round(Math.min(270, Math.max(210, 150 + distance * 0.4)) * 1.08));
    }
    const indicator = read("../../s19/tabIndicator.ts");
    expect(indicator).toContain("SELECTION_GLIDE");
    expect(indicator).toContain("selectionGlideDuration(dist");
    expect(indicator).not.toMatch(/dist \* 0\.35|1\.5 \+ dist \* 0\.01|150 \+ dist \* 0\.4/);
  });

  it("C：两帧直达，不拉伸、不越界；时长 120–170ms，曲线取 C 的导航曲线", () => {
    const [from, to] = nav;
    const { frames, duration } = slideFrames(from, to, "y");
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ transform: "translate3d(4px, 8px, 0)", height: "48px", easing: NAVIGATION.c.easing });
    expect(frames[1]).toMatchObject({ transform: "translate3d(4px, 108px, 0)", height: "48px" });
    expect(duration).toBe(130);
    expect(slideFrames(from, { ...to, y: 8 + 1000 }, "y").duration).toBe(170);
    expect(slideFrames(from, { ...from, y: 10 }, "y").duration).toBe(120);
  });
});

describe("已选条件标签：出现、删除与焦点", () => {
  const item = (key: string, label = key): ConditionTagItem => ({ key, label, removeLabel: `清除${label}条件` });
  const rest = (...keys: string[]): ConditionTagEntry[] => keys.map(key => ({ item: item(key), state: "rest" }));
  const states = (entries: readonly ConditionTagEntry[]): string[] => entries.map(entry => `${entry.item.key}:${entry.state}`);

  it("新条件标 in，保留的维持原状态，被删除的标 out 并留在原来的位置", () => {
    expect(states(reconcileTags(rest("time", "tags"), [item("time"), item("tags"), item("currencies")]))).toEqual(["time:rest", "tags:rest", "currencies:in"]);
    expect(states(reconcileTags(rest("time", "tags", "currencies"), [item("time"), item("currencies")]))).toEqual(["time:rest", "tags:out", "currencies:rest"]);
    expect(states(reconcileTags(rest("time", "tags"), [item("tags")]))).toEqual(["time:out", "tags:rest"]);
    expect(states(reconcileTags(rest("time"), []))).toEqual(["time:out"]);
  });

  it("退场途中又加回来的重新出现；文字变化不重播动画", () => {
    const leaving: ConditionTagEntry[] = [{ item: item("time"), state: "out" }, ...rest("tags")];
    expect(states(reconcileTags(leaving, [item("time"), item("tags")]))).toEqual(["time:in", "tags:rest"]);
    const renamed = reconcileTags(rest("time"), [item("time", "2026年12月")]);
    expect(renamed).toEqual([{ item: item("time", "2026年12月"), state: "rest" }]);
  });

  it("键盘删除后焦点交给后一个标签，没有就前一个，都没有交给标签组；正在退场的不算", () => {
    const entries: ConditionTagEntry[] = [...rest("a"), { item: item("b"), state: "out" }, ...rest("c", "d")];
    expect(focusAfterRemoval(entries, "c")).toBe("d");
    expect(focusAfterRemoval(entries, "d")).toBe("c");
    expect(focusAfterRemoval(entries, "a")).toBe("c");
    expect(focusAfterRemoval(rest("a"), "a")).toBeNull();
    expect(focusAfterRemoval(rest("a"), "zzz")).toBeNull();
  });

  it("静态渲染：标签组是 group；每个标签是带可访问名称的删除按钮，× 不进辅助技术树；没有条件时显示 empty", () => {
    const html = renderToStaticMarkup(<ConditionTags aria-label="已选条件" items={[{ ...item("time", "2026年11月"), title: "2026年11月" }, item("tags", "标签：出差")]} onRemove={() => undefined} empty={<span>全部</span>} />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="已选条件"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('aria-label="清除2026年11月条件"');
    expect(html).toContain('title="2026年11月"');
    expect(html).toContain('data-cond-tag-x="" aria-hidden="true">×</span>');
    expect(html).toContain('data-state="rest"'); // 初次挂载不播放出现动画
    expect(html).not.toContain("全部");
    expect(renderToStaticMarkup(<ConditionTags aria-label="已选条件" items={[]} onRemove={() => undefined} empty={<span>全部</span>} />)).toContain("<span>全部</span>");
  });

  it("退场中的标签不可聚焦、不可点、不进辅助技术树", () => {
    const html = renderToStaticMarkup(<ConditionTag item={item("time")} state="out" />);
    expect(html).toContain('data-state="out"');
    expect(html).toContain('inert=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('tabindex="-1"');
  });
});

describe("结构与无障碍属性", () => {
  it("MovingSelection 保留调用方的 tablist / tab / aria-selected 与键盘处理位置；选中块 aria-hidden，未测量前不标就绪", () => {
    const html = renderToStaticMarkup(<MovingSelection axis="y" role="tablist" aria-label="筛选" aria-orientation="vertical" className="lv-filter-nav">
      <button type="button" role="tab" aria-selected>时间</button><button type="button" role="tab" aria-selected={false}>分类</button>
    </MovingSelection>);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('class="lv-filter-nav"');
    expect(html).toContain('data-axis="y"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-select-block="" aria-hidden="true"');
    expect(html).not.toContain("data-select-ready");
    expect(html).not.toContain("data-select-base");
  });

  it("共享分段控件：group + aria-pressed + 真实 disabled；基础外观声明原滑动胶囊", () => {
    const html = renderToStaticMarkup(<SegmentedControl label="明暗" value="light" options={[{ value: "auto", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色", disabled: true }]} onChange={() => undefined} />);
    expect(html).toContain('role="group" aria-label="明暗"');
    expect(html).toContain('data-select-base="slide"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('disabled=""');
    expect(html.match(/<button/g)).toHaveLength(3);
  });

  it("base=\"copy\"（1.19.67，SlidingSelection）：声明在容器上；基础外观才复制选中样式，S19 清掉复制的内联外观", () => {
    const html = renderToStaticMarkup(<MovingSelection axis="x" base="copy" role="group" aria-label="收支"><button type="button" aria-pressed>支出</button></MovingSelection>);
    expect(html).toContain('data-select-base="copy"');
    const source = read("./SelectionControls.tsx");
    expect(source).toContain('if (base === "copy" && selectionStyleOf(root) === null) {');
    expect(source).toContain("Object.assign(block.style, { background: paint.background, boxShadow: paint.boxShadow, borderRadius: paint.borderRadius, border: paint.border, opacity: paint.opacity });");
    expect(source).toContain('if (base === "copy") Object.assign(block.style, { background: "", boxShadow: "", border: "", opacity: "" });');
  });

  it("ToggleButton（1.19.67）就是调用方的 type=button + aria-pressed 开关按钮，只多 data-select-toggle 钩子；不改成 switch", () => {
    const on = renderToStaticMarkup(<ToggleButton className="lv-filter-multi" pressed title="多选月份" onClick={() => undefined}>多选</ToggleButton>);
    expect(on).toBe('<button type="button" class="lv-filter-multi" title="多选月份" aria-pressed="true" data-select-toggle="">多选</button>');
    const off = renderToStaticMarkup(<ToggleButton className="sw-icon-button" pressed={false} aria-label="替换" disabled>⇄</ToggleButton>);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('disabled=""');
    expect(off).not.toContain('role="switch"');
  });

  it("SelectionGrid 只加钩子，月份格仍是调用方的 aria-pressed 按钮", () => {
    const html = renderToStaticMarkup(<SelectionGrid className="lv-filter-months" data-multi><button type="button" aria-pressed>11月</button></SelectionGrid>);
    expect(html).toBe('<div class="lv-filter-months" data-multi="true" data-select-grid=""><button type="button" aria-pressed="true">11月</button></div>');
  });

  it("SelectionItem（1.19.65）就是调用方的 type=button 按钮，只多一个 data-select-item 钩子；aria、类名、内容原样保留", () => {
    const html = renderToStaticMarkup(<SelectionItem className="lv-filter-option" aria-pressed onClick={() => undefined}>CNY · 人民币<svg aria-hidden="true" /></SelectionItem>);
    expect(html).toBe('<button type="button" class="lv-filter-option" aria-pressed="true" data-select-item="">CNY · 人民币<svg aria-hidden="true"></svg></button>');
    expect(renderToStaticMarkup(<SelectionItem aria-pressed={false}>不限</SelectionItem>)).toContain('aria-pressed="false"');
  });
});

describe("外观：四种风格同一个模型", () => {
  const css = strip(read("./selection-controls.css"));
  const block = (prefix: string): string => {
    const start = css.indexOf(prefix);
    expect(start, prefix).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
    }
    return "";
  };

  it("S19 规则都挂在浅色作用域标记下；基础外观不显示选中块", () => {
    expect(css).toContain("[data-select-block] { display: none;");
    for (const prefix of [
      ':root[data-visual-style][data-theme-mode="light"] .lv-shell[data-s19-scope] {',
      ':root:is([data-visual-style="b1"], [data-visual-style="b2"])[data-theme-mode="light"] .lv-shell[data-s19-scope] {',
      ':root[data-visual-style="c"][data-theme-mode="light"] .lv-shell[data-s19-scope] {',
      ':root[data-visual-style="a"][data-theme-mode="light"] .lv-shell[data-s19-scope] {',
    ]) expect(block(prefix).length, prefix).toBeGreaterThan(0);
  });

  it("B1 / B2 用选中玻璃（不染色）；C 用实底；A 不显示色块、按 A2 档浮起（表面层 + 环境影分层）", () => {
    const glass = block(':root:is([data-visual-style="b1"], [data-visual-style="b2"])');
    expect(glass).toContain("var(--s19-select-glass-bg)");
    expect(glass).toContain("var(--s19-select-glass-sh)");
    expect(glass).not.toContain("--color-brand");
    expect(block(':root[data-visual-style="c"]')).toContain("var(--s19-select-solid-bg)");
    const a = block(':root[data-visual-style="a"]');
    expect(a).toContain("[data-select-moving] > [data-select-block] { display: none; }");
    expect(a).toContain("var(--s19-a-elev-2-surface)");
    expect(a).toContain("var(--s19-a-elev-2-ambient)");
    expect(a).toContain("translateY(var(--s19-a-lift-y)) scale(var(--s19-a-lift-scale))");
    expect(a).toContain("scale(var(--s19-a-lift-scale-cell))");
    expect(a).toContain("var(--lv-lift-rise-ease)");
  });

  it("独立选中项（1.19.65）在四种风格里与网格选中同一规则：B1 / B2 玻璃淡入、C 实底淡入、A 按标准 A2 档浮起（不用月份格的放大）", () => {
    const item = '[data-select-item]:is([aria-selected="true"], [aria-pressed="true"], [aria-checked="true"]):not(:disabled)';
    const common = block(':root[data-visual-style][data-theme-mode="light"]');
    expect(common).toContain("[data-select-grid] > button, [data-select-item] { position: relative; }");
    expect(common).toContain(`${item} {\n    background: transparent; box-shadow: none; border-color: transparent; color: var(--color-brand-dark);`);
    expect(common).toContain(":is([data-select-grid] > button, [data-select-item])::before { content: \"\";");
    const glass = block(':root:is([data-visual-style="b1"], [data-visual-style="b2"])');
    expect(glass).toContain(":is([data-select-grid] > button, [data-select-item])::before {\n    background: var(--s19-select-glass-bg);");
    expect(glass).toContain(`${item}::before { opacity: 1; transform: none; }`);
    const c = block(':root[data-visual-style="c"]');
    expect(c).toContain(":is([data-select-grid] > button, [data-select-item])::before { background: var(--s19-select-solid-bg);");
    expect(c).toContain(`${item}::before { opacity: 1; }`);
    const a = block(':root[data-visual-style="a"]');
    expect(a).toContain(`${item} {\n    transform: translateY(var(--s19-a-lift-y)) scale(var(--s19-a-lift-scale));`);
    expect(a).toContain(":is([data-select-moving] > button, [data-select-grid] > button, [data-select-item])::after {");
    expect(a).toContain(`${item}::after {`);
    // 月份格的放大只给网格的直接子按钮
    expect(a).toMatch(/\n {2}\[data-select-grid\] > button:is\(\[aria-pressed="true"\], \[aria-checked="true"\]\):not\(:disabled\) \{ transform: translateY\(var\(--s19-a-lift-y\)\) scale\(var\(--s19-a-lift-scale-cell\)\); \}/);
    expect(block("@media (prefers-reduced-motion: reduce)")).toContain("[data-select-item], [data-select-item]::before, [data-select-item]::after,");
  });

  it("base=\"copy\"（1.19.67）：基础外观里选中块在未选按钮之上、文字层之下；S19 的 B1 / B2 / C 取消按钮隔离让文字盖住选中块，A 保留隔离", () => {
    expect(css).toContain(':is([data-select-base="slide"], [data-select-base="copy"])[data-select-ready] > [data-select-block] { display: block; }');
    expect(css).toContain('[data-select-moving][data-select-base="copy"] > button { z-index: auto; transition-property: color, filter; }');
    expect(css).toContain("[data-select-label] { position: relative; z-index: 1;");
    expect(css).toMatch(/\[data-select-base="copy"\]\[data-select-ready\] > button:is\(\[aria-selected="true"\], \[aria-pressed="true"\], \[aria-checked="true"\]\) \{\s*background: transparent !important;/);
    const noIsolation = '[data-select-moving][data-select-base="copy"] > button { isolation: auto; }';
    expect(block(':root:is([data-visual-style="b1"], [data-visual-style="b2"])')).toContain(noIsolation);
    expect(block(':root[data-visual-style="c"]')).toContain(noIsolation);
    expect(block(':root[data-visual-style="a"]')).not.toContain(noIsolation);
  });

  it("开关按钮（1.19.67）开启时按同一模型：B1 / B2 玻璃、A 按 A2 浮起、C 浅绿实底；材质只在 ::before，不动 ::after 与焦点环", () => {
    const on = '[data-select-toggle][aria-pressed="true"]';
    const common = block(':root[data-visual-style][data-theme-mode="light"]');
    expect(common).toContain(`${on} { background: transparent; border-color: transparent; color: var(--color-brand-dark); }`);
    expect(common).toContain('[data-select-toggle]::before { content: ""; position: absolute; inset: 0; z-index: -1;');
    const glass = block(':root:is([data-visual-style="b1"], [data-visual-style="b2"])');
    expect(glass).toContain("[data-select-toggle]::before {\n    background: var(--s19-select-glass-bg); box-shadow: var(--s19-select-glass-sh);");
    expect(glass).toContain(`${on}::before { opacity: 1; transform: none; }`);
    const c = block(':root[data-visual-style="c"]');
    expect(c).toContain("[data-select-toggle]::before { background: var(--s19-select-solid-bg);");
    expect(c).toContain(`${on}::before { opacity: 1; }`);
    const a = block(':root[data-visual-style="a"]');
    expect(a).toContain("[data-select-toggle]::before { background: var(--s19-select-lift-bg); box-shadow: var(--s19-a-elev-2);");
    expect(a).toContain(`${on} {\n    transform: translateY(var(--s19-a-lift-y)) scale(var(--s19-a-lift-scale));`);
    // ::after 是调用方的命中区（.lv-filter-multi 上下各扩 6px）；开关按钮的规则不碰它，也不清掉调用方的 box-shadow（焦点环）。
    expect(css).not.toMatch(/\[data-select-toggle\][^{,]*::after/);
    expect(css).not.toMatch(/\[data-select-toggle\]\[aria-pressed="true"\] \{[^}]*box-shadow/);
    expect(block("@media (prefers-reduced-motion: reduce)")).toContain("[data-select-toggle], [data-select-toggle]::before,");
  });

  it("条件标签：出现 / 删除用各风格的 reveal / dismiss 时长与起始缩放；删除命中区约 44px 高", () => {
    const common = block(':root[data-visual-style][data-theme-mode="light"]');
    expect(common).toContain("animation: lv-cond-tag-in var(--lv-reveal-ms)");
    expect(common).toContain("animation: lv-cond-tag-out var(--lv-dismiss-ms)");
    expect(common).toContain("var(--s19-tag-bg)");
    expect(css).toContain("scale: var(--lv-tag-from-scale");
    expect(css).toContain("[data-cond-tag]::after { content: \"\"; position: absolute; inset: min(0px, calc((100% - 44px) / 2)) 0; }");
  });

  it("减少动态效果：过渡与动画全部关闭（脚本动画另行判断）", () => {
    const reduced = block("@media (prefers-reduced-motion: reduce)");
    expect(reduced).toContain("[data-cond-tag]");
    expect(reduced).toContain("> button::after");
    expect(reduced).toContain("transition: none !important; animation: none !important;");
    const source = read("./SelectionControls.tsx");
    expect(source).toContain("selectionMotion(selectionStyleOf(root), base, reducedMotion())");
    expect(source).toContain("selectionStyleOf(root) === null || reducedMotion()");
  });
});

describe("A 浮起档位（令牌）", () => {
  const tokens = strip(read("../../s19/s19-lab-tokens.css"));
  const a = tokens.slice(tokens.indexOf(':root[data-visual-style="a"] {'), tokens.indexOf(':root[data-visual-style="b1"] {'));
  const value = (name: string): string => new RegExp(`${name}:\\s*([^;]+);`).exec(a)?.[1]?.trim() ?? "";

  it("五档都有定义，A2 拆成表面层与环境影", () => {
    for (const name of ["--s19-a-elev-0", "--s19-a-elev-1", "--s19-a-elev-1-tight", "--s19-a-elev-2-surface", "--s19-a-elev-2-ambient", "--s19-a-elev-2", "--s19-a-elev-3", "--s19-a-elev-4", "--s19-a-elev-4-up"]) expect(value(name), name).not.toBe("");
    expect(value("--s19-a-elev-2")).toBe("var(--s19-a-elev-2-surface), var(--s19-a-elev-2-ambient)");
  });

  it("A 的阴影令牌只引用档位（归档表）；主按钮光晕是强调，不动", () => {
    const archive: Record<string, string> = {
      "--s19-track-sh": "var(--s19-a-elev-0)",
      "--s19-card-sh": "var(--s19-a-elev-1)", "--s19-ticket-sh": "var(--s19-a-elev-1)", "--s19-key-sh-tight": "var(--s19-a-elev-1-tight)",
      "--s19-pill-sh": "var(--s19-a-elev-2)", "--s19-tool-sh": "var(--s19-a-elev-2)",
      "--s19-key-sh": "var(--s19-a-elev-3)", "--s19-shelf-sh": "var(--s19-a-elev-3)",
      "--s19-sheet-sh": "var(--s19-a-elev-4-up)", "--s19-dock-sh": "var(--s19-a-elev-4-up)", "--s19-action-bar-sh": "var(--s19-a-elev-4-up)", "--s19-dialog-sh": "var(--s19-a-elev-4)",
    };
    for (const [name, expected] of Object.entries(archive)) expect(value(name), name).toBe(expected);
    expect(value("--s19-mini-sh")).toBe("var(--s19-card-sh)");
    expect(value("--s19-entry-sh")).toBe("var(--s19-card-sh)");
    // 金额框与加号：A3 + 品牌色光晕（强调层）。
    expect(value("--s19-amount-sh")).toMatch(/^var\(--s19-a-elev-3\), .*var\(--color-brand\)/);
    expect(value("--s19-plus-sh")).toMatch(/^0 0 0 4px #fff, var\(--s19-a-elev-3-drop\), .*var\(--color-brand\)/);
    expect(value("--s19-accent-sh")).toContain("var(--color-brand) 75%");
  });

  it("档位的影子一律用墨色，不用纯黑", () => {
    const levels = a.split("\n").filter(line => /--s19-a-elev-/.test(line.split(":")[0] ?? ""));
    expect(levels.length).toBeGreaterThanOrEqual(9);
    for (const line of levels) expect(line, line).not.toMatch(/rgb\(0 0 0|#000/);
    expect(value("--s19-a-ink")).toBe("36 49 43");
  });
});

describe("筛选面板接入", () => {
  const source = read("../EntryFilterPanel.tsx");
  it("左侧维度导航、月份 / 日期范围、月份网格、已选条件标签用正式组件，原有角色与 aria 不变", () => {
    expect(source).toContain('<MovingSelection axis="y" className="lv-filter-nav" role="tablist" aria-label={t("ledger.filters.title")} aria-orientation="vertical"');
    expect(source).toContain('role="tab" aria-selected={section === key}');
    expect(source).toContain('<MovingSelection axis="x" className="lv-filter-segments">');
    expect(source).toContain("aria-pressed={!rangeMode}");
    expect(source).toContain('<SelectionGrid className="lv-filter-months" data-multi={multi || undefined}>');
    expect(source).toContain('<ConditionTags className="lv-filter-chips" aria-label={t("ledger.filters.selected")}');
    expect(source).toContain('removeLabel: t("ledger.filters.clear", { name: t(`ledger.filters.${key}`) })');
    expect(source).toContain('onRemove={key => { setDraft(clearFilterDimension(draft, key as FilterDimension)); if (key === "time") setRangeMode(false); }}');
  });

  it("1.19.65：其余选中控件也用正式组件，条件、点击处理与 aria-pressed 原样保留", () => {
    // 选项列表是多选（每行独立），“不限”是清空：独立选中项
    expect(source).toContain('<SelectionItem className="lv-filter-option" aria-pressed={draft[section].length === 0} onClick={() => setDraft(clearFilterDimension(draft, section))}>');
    expect(source).toContain('<SelectionItem className="lv-filter-option" aria-pressed={draft[section].includes(item.id)} onClick={() => toggle(section, item.id)}>');
    expect(source).toContain("const toggle = (key: \"categories\" | \"payments\" | \"tags\" | \"currencies\" | \"recorders\", id: string) => change({ [key]: draft[key].includes(id) ? draft[key].filter(v => v !== id) : [...draft[key], id]");
    // “全部时间”与月份格同一规则
    expect(source).toContain('<SelectionItem className="lv-filter-option lv-filter-all-time" aria-pressed={isAllMonths(draft.month) && draft.months.length === 0} onClick={() => change({ month: ALL_MONTHS, from: "", to: "", months: [] })}>');
    // 附件：三项互斥一行 → 横向会移动的选中；文件类型会折行 → 网格选中
    expect(source).toContain('<MovingSelection axis="x" className="lv-filter-choices">{(["any", "has", "none"] as const).map(v => <button type="button" key={v} aria-pressed={draft.attachment === v} onClick={() => change({ attachment: v, ...(v === "none" ? { type: "" } : {}) })}>');
    expect(source).toContain('<SelectionGrid className="lv-filter-choices">{([["", "anyType"], ["image/", "image"], ["application/pdf", "pdf"], ["audio/", "audio"], ["text/", "text"]] as const).map(([v, key]) => <button type="button" key={key} aria-pressed={draft.type === v} onClick={() => change({ type: v!, ...(v ? { attachment: "has" } : {}) })}>');
    // 记录人“只看自己”：独立选中项
    expect(source).toContain('<SelectionItem className="lv-filter-mine" aria-pressed={draft.recorders.length === 1 && draft.recorders[0] === people.self} onClick={() => change({ recorders: [people.self!] })}>');
    // 没有遗留的手写选中控件
    expect(source).not.toMatch(/<button type="button" className="lv-filter-(option|mine)/);
    expect(source).not.toContain('<div className="lv-filter-choices">');
    // 开关保持开关：标题行“多选”仍是 aria-pressed 开关按钮（底部面板与电脑版两处；1.19.67 起是 ToggleButton，渲染的仍是
    // type=button + aria-pressed 的按钮，类名与点击不变），“含子分类”仍是复选框
    expect(source.match(/<ToggleButton className="lv-filter-multi" pressed=\{multi\} title=\{t\("ledger\.filters\.multiSelectLabel"\)\} onClick=\{toggleMulti\}>/g)).toHaveLength(2);
    expect(source).not.toContain('className="lv-filter-multi" aria-pressed');
    expect(source).toContain('<label className="lv-filter-branch text-helper"><input type="checkbox" checked={draft.branches.includes(item.id)}');
  });

  it("1.19.65：“只看自己”未选中时的正文色只在 S19 浅色作用域里改，Original、深色不变", () => {
    const filters = strip(read("../entry-filters.css"));
    expect(filters).toContain(':root[data-visual-style][data-theme-mode="light"] .lv-shell[data-s19-scope] .lv-filter-mine:not([aria-pressed="true"]) { color:var(--color-ink); }');
    expect(filters).toContain(".lv-filter-mine { min-height:36px; margin-bottom:12px; padding:6px 14px; border-radius:999px; border:1px solid var(--color-line); color:var(--color-brand-dark); }");
    expect(filters).toContain(".lv-filter-mine[aria-pressed=true] { border-color:transparent; background:var(--color-brand-soft); }");
  });
});
