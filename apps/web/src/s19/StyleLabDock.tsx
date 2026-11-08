// i18n-ignore-file 仅开发/测试环境的风格实验把手，不面向正式用户。
import { useState, useSyncExternalStore } from "react";
import { VISUAL_STYLES, VISUAL_STYLE_LABELS, type VisualStyle, type VisualStyleController } from "../lib/visualStyle.js";
import { TAB_MOTIONS, TAB_MOTION_LABELS, chooseTabMotion, subscribeTabMotion, tabMotion } from "./tabMotion.js";
import { A_VARIANTS, aVariant, chooseAVariant, subscribeAVariant } from "./motion/abcBridge.js";

const SHORT: Readonly<Record<VisualStyle, string>> = { original: "Orig", a: "A", b1: "B1", b2: "B2", c: "C" };

/**
 * 页面右侧的小把手：点开后在 Original / A / B1 / B2 / C 之间切换。
 * 只改 `<html data-visual-style>`，当前页面、滚动位置、筛选与登录状态都不动。
 */
export function StyleLabDock({ controller }: { readonly controller: VisualStyleController }): React.JSX.Element {
  const style = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const motion = useSyncExternalStore(subscribeTabMotion, tabMotion, tabMotion);
  const variant = useSyncExternalStore(subscribeAVariant, aVariant, aVariant);
  const [open, setOpen] = useState(false);
  return (
    <div className="s19-dock" data-open={open ? "true" : "false"}>
      {open ? (
        <div className="s19-dock-panel" role="group" aria-label="S19 视觉风格（测试）">
          <p className="s19-dock-title">S19 视觉风格 · 测试</p>
          {VISUAL_STYLES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={style === value}
              className="s19-dock-option"
              onClick={() => { controller.choose(value); setOpen(false); }}
            >
              <span className="s19-dock-name">{VISUAL_STYLE_LABELS[value].name}</span>
              <span className="s19-dock-note">{VISUAL_STYLE_LABELS[value].note}</span>
            </button>
          ))}
          <label className="s19-dock-title s19-dock-sub">
            A 页面转场候选（我的 / 设置）
            <select className="w-full rounded-field border border-line bg-surface p-2 text-base" aria-label="A 页面转场候选" value={variant ?? ""} onChange={event => chooseAVariant(A_VARIANTS.find(value => value === event.target.value) ?? null)}>
              <option value="">未选择 · 保留原行为</option>
              {A_VARIANTS.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <p className="s19-dock-title s19-dock-sub">Tab Indicator Motion（B1 / B2 底栏）</p>
          <div className="s19-dock-row" role="group" aria-label="Tab Indicator Motion">
            {TAB_MOTIONS.map((value) => (
              <button key={value} type="button" aria-pressed={motion === value} className="s19-dock-option s19-dock-chip" onClick={() => chooseTabMotion(value)}>
                <span className="s19-dock-name">{TAB_MOTION_LABELS[value]}</span>
              </button>
            ))}
          </div>
          <p className="s19-dock-foot">只作用于手机布局的浅色模式；Pad、电脑版与深色模式保持 Original。</p>
        </div>
      ) : null}
      <button
        type="button"
        className="s19-dock-handle"
        aria-expanded={open}
        aria-label={`S19 视觉风格：${VISUAL_STYLE_LABELS[style].name}，点按切换`}
        onClick={() => setOpen((value) => !value)}
      >
        {SHORT[style]}
      </button>
    </div>
  );
}
