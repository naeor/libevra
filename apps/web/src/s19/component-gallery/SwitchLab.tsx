// i18n-ignore-file 开发用设计样板：切换类控件与开关按钮（1.19.67），只含静态示例文字，不读写业务数据、不进正式构建。
import { useLayoutEffect, useState } from "react";
import { KindToggle } from "../../components/entry/KindToggle.js";
import { MovingSelection, ToggleButton } from "../../components/ui/SelectionControls.js";
import { SlidingSelection } from "../../components/ui/SlidingSelection.js";
import { applyB2Glass, B2_GLASS_PRESETS } from "../b2Glass.js";
import "../../components/entry-filters.css";
import "./switch-lab.css";

/**
 * **切换类控件与开关按钮（1.19.67）**：迁到“四种风格同一个模型”的几类控件放在一块手机尺寸的画面里。
 * 直接引用正式组件（`KindToggle`、`SlidingSelection`、`MovingSelection`、`ToggleButton`）；外观页明暗三选一、明细的全部 / 支出 / 收入、
 * 批量修改的添加 / 移除用与页面相同的写法（同样的类名与容器），因为它们在正式页面里是页面内的写法，不是单独的组件。
 * 正式页面里明暗三选一要登录后才能打开（外观设置），批量修改要有账目并进入批量模式，游客截图到不了，所以在这里核对外观。
 *
 * 固定画面：`component-gallery.html?shot=switches&s19=original|a|b1|b2|c`（可加 `&theme=dark`）——五种外观构图完全相同。
 */
export function SwitchBoard(): React.JSX.Element {
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [detail, setDetail] = useState<"all" | "expense" | "income">("all");
  const [mode, setMode] = useState<"system" | "light" | "dark">("light");
  const [tagMode, setTagMode] = useState<"add" | "remove">("add");
  const [multi, setMulti] = useState(true);
  return <div className="tgl-stage">
    <p className="tgl-cap">记一笔 · 支出 / 收入（KindToggle）</p>
    <KindToggle label="收支" value={kind} options={[{ value: "expense", label: "支出" }, { value: "income", label: "收入" }]} onChange={setKind} />

    <p className="tgl-cap">明细 · 全部 / 支出 / 收入（与明细页同一写法）</p>
    <SlidingSelection className="flex gap-1 rounded-full bg-line/70 p-1">
      {(["all", "expense", "income"] as const).map(option => <button key={option} type="button" aria-pressed={detail === option} onClick={() => setDetail(option)}
        className={`flex-1 rounded-full py-2 text-sm font-medium transition ${detail === option ? "bg-surface text-brand-dark shadow-sm" : "text-muted hover:text-ink"}`}>
        {option === "all" ? "全部" : option === "expense" ? "支出" : "收入"}
      </button>)}
    </SlidingSelection>

    <section className="lv-settings-theme-options flex flex-col gap-2">
      <h2 className="tgl-cap">外观 · 明暗三选一（与外观页同一写法）</h2>
      <MovingSelection axis="x" role="group" aria-label="明暗" className="grid grid-cols-3 gap-1 rounded-field bg-surface p-1">
        {(["system", "light", "dark"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
          className={`min-h-11 rounded-field px-1 py-2 text-button font-medium outline-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark ${mode === value ? "bg-brand-soft text-brand-dark shadow-card ring-1 ring-brand" : "text-muted hover:text-ink"}`}>
          {value === "system" ? "跟随系统" : value === "light" ? "浅色" : "深色"}
        </button>)}
      </MovingSelection>
    </section>

    <div className="tgl-sheet rounded-t-sheet bg-surface">
      <div className="tgl-head"><b>筛选</b><span className="tgl-note">开关按钮 · 关闭</span>
        <ToggleButton className="lv-filter-multi" pressed={false} tabIndex={-1}>多选</ToggleButton></div>
      <div className="tgl-head"><b>筛选</b><span className="tgl-note">开关按钮 · 开启</span>
        <ToggleButton className="lv-filter-multi" pressed tabIndex={-1}>多选</ToggleButton></div>
      <div className="tgl-head"><b>筛选</b><span className="tgl-note">点按切换</span>
        <ToggleButton className="lv-filter-multi" data-switch-live="" pressed={multi} onClick={() => setMulti(v => !v)}>多选</ToggleButton></div>
      <p className="tgl-cap tgl-inset">批量修改 · 标签添加 / 移除（与批量修改同一写法）</p>
      <div className="tgl-inset">
        <SlidingSelection className="mt-2 flex gap-1 rounded-full bg-line/70 p-1">
          {(["add", "remove"] as const).map(value => <button key={value} type="button" aria-pressed={tagMode === value} onClick={() => setTagMode(value)}
            className={`flex-1 rounded-full py-1.5 text-helper transition disabled:opacity-45 ${tagMode === value ? "bg-surface text-brand-dark shadow-sm" : "text-muted"}`}>
            {value === "add" ? "添加这些标签" : "移除这些标签"}
          </button>)}
        </SlidingSelection>
      </div>
    </div>
  </div>;
}

type ShotStyle = "original" | "a" | "b1" | "b2" | "c";
const SHOT_STYLES: readonly ShotStyle[] = ["original", "a", "b1", "b2", "c"];

/** `?shot=switches`：只渲染这一块画面，五种外观构图完全相同。 */
export function SwitchShot(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const style = SHOT_STYLES.find((value) => value === params.get("s19")) ?? "b2";
  const dark = params.get("theme") === "dark";
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (style === "original") delete root.dataset.visualStyle;
    else root.dataset.visualStyle = style;
    root.dataset.themeMode = dark ? "dark" : "light";
    applyB2Glass(root.style, B2_GLASS_PRESETS.balanced, "balanced");
  }, [style, dark]);
  return <main className="lv-shell tgl-shot" data-shell="contents" data-s19-scope="phone">
    <header className="tgl-shot-head"><b>切换与开关按钮</b><span>{style === "original" ? "Original" : style.toUpperCase()}{dark ? " · 深色" : ""}</span></header>
    <SwitchBoard />
  </main>;
}
