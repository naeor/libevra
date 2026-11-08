// i18n-ignore-file 仅开发/测试环境的风格实验开关，不面向正式用户。
import { useSyncExternalStore } from "react";
import { VISUAL_STYLES, VISUAL_STYLE_LABELS, visualStyleRuntime, type VisualStyleController } from "../lib/visualStyle.js";
import { TAB_MOTIONS, TAB_MOTION_LABELS, chooseTabMotion, subscribeTabMotion, tabMotion } from "./tabMotion.js";
import { DEFAULT_GLASS_BLUR } from "./material.js";

const noop = (): (() => void) => () => undefined;

/**
 * 设置 → 外观 → 主题里的“S19 视觉风格（测试）”。只有风格实验已启动（开发环境或
 * `VITE_S19_STYLE_LAB=1` 的测试构建）时才渲染；正式环境里返回 `null`。
 */
export function VisualStyleLabSection(): React.JSX.Element | null {
  const controller: VisualStyleController | null = visualStyleRuntime();
  const snapshot = (): string => controller?.getSnapshot() ?? "original";
  const style = useSyncExternalStore(controller?.subscribe ?? noop, snapshot, snapshot);
  const blurSnapshot = (): number => controller?.getBlurSnapshot() ?? DEFAULT_GLASS_BLUR;
  const blur = useSyncExternalStore(controller?.subscribe ?? noop, blurSnapshot, blurSnapshot);
  const motionSnapshot = (): string => (controller === null ? "v1" : tabMotion());
  const motion = useSyncExternalStore(controller === null ? noop : subscribeTabMotion, motionSnapshot, motionSnapshot);
  if (controller === null) return null;
  return (
    <section className="lv-settings-theme-options flex flex-col gap-2" data-s19-lab="">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-section-title text-ink">S19 视觉风格（测试）</h2>
        <span className="text-helper text-muted">仅开发 / 测试环境</span>
      </div>
      <div role="group" aria-label="S19 视觉风格（测试）" className="flex flex-col gap-1 rounded-field bg-surface p-1">
        {VISUAL_STYLES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={style === value}
            onClick={() => controller.choose(value)}
            className={`flex min-h-11 flex-col items-start rounded-field px-3 py-2 text-left outline-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark ${
              style === value ? "bg-brand-soft text-brand-dark shadow-card ring-1 ring-brand" : "text-ink hover:bg-canvas"
            }`}
          >
            <span className="text-button font-medium">{VISUAL_STYLE_LABELS[value].name}</span>
            <span className="text-helper text-muted">{VISUAL_STYLE_LABELS[value].note}</span>
          </button>
        ))}
      </div>
      <p className="text-helper text-muted">切换只改外观，不会重新登录或丢失当前页面。只作用于手机布局的浅色模式。</p>
      {style === "b1" && <fieldset className="flex min-w-0 flex-col gap-2 rounded-field bg-surface p-3">
        <legend className="text-section-title text-ink">玻璃模糊强度</legend>
        <label className="flex flex-col gap-1 text-helper text-muted">
          <span className="flex justify-between"><span>清晰</span><output>{blur} / 100</output><span>朦胧</span></span>
          <input type="range" min="0" max="100" step="1" value={blur} aria-label="玻璃模糊强度" aria-valuetext={`${blur} / 100`} onChange={event => controller.chooseBlur(Number(event.currentTarget.value))} className="min-h-11 w-full accent-brand" />
        </label>
        <div className="grid grid-cols-3 gap-2">
          {([{ value: 35, label: "清晰" }, { value: DEFAULT_GLASS_BLUR, label: "标准" }, { value: 100, label: "朦胧" }]).map(preset => (
            <button type="button" key={preset.value} aria-pressed={blur === preset.value} onClick={() => controller.chooseBlur(preset.value)} className={`min-h-11 rounded-field text-button focus-visible:outline-brand-dark ${blur === preset.value ? "bg-brand-soft text-brand-dark ring-1 ring-brand" : "bg-canvas text-ink"}`}>{preset.label}</button>
          ))}
        </div>
        <button type="button" onClick={() => controller.resetBlur()} className="min-h-11 self-start text-button text-brand-dark focus-visible:outline-brand-dark">恢复默认值</button>
      </fieldset>}
      {style === "b1" && <p className="text-helper text-muted">仅 B1 生效；拖动即预览，自动保存在这台设备。切换其他风格后保留选择。</p>}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-section-title text-ink">Tab Indicator Motion</h2>
        <span className="text-helper text-muted">B1 / B2 底栏</span>
      </div>
      <div role="group" aria-label="Tab Indicator Motion" className="grid grid-cols-2 gap-1 rounded-field bg-surface p-1">
        {TAB_MOTIONS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={motion === value}
            onClick={() => chooseTabMotion(value)}
            className={`min-h-11 rounded-field px-2 py-2 text-left text-helper font-medium outline-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark ${
              motion === value ? "bg-brand-soft text-brand-dark shadow-card ring-1 ring-brand" : "text-ink hover:bg-canvas"
            }`}
          >
            {TAB_MOTION_LABELS[value]}
          </button>
        ))}
      </div>
    </section>
  );
}
