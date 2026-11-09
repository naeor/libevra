import { useSyncExternalStore } from "react";
import { useI18n } from "../i18n/index.js";
import { visualStyleRuntime, type VisualStyleController } from "../lib/visualStyle.js";
import { DEFAULT_GLASS_BLUR, materialAttributes } from "../s19/material.js";
import "../s19/material-components.css";
import { B2GlassSection } from "../s19/B2GlassSection.js";
import { WallpaperSection } from "../s19/WallpaperSection.js";

export const APPEARANCE_STYLES = ["c", "a", "b1", "b2"] as const;
export const B1_BLUR_PRESETS = [30, 55, 80] as const;
const noop = () => () => undefined;

/** 本页局部高度过渡；隐藏后立即 inert，不改共享 MotionPresence 或路由动效。 */
function Reveal({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return <div className="appearance-reveal" data-visible={visible} inert={!visible} aria-hidden={!visible}>
    <div className="appearance-reveal-clip"><div className="appearance-reveal-content">{children}</div></div>
  </div>;
}

export function AppearanceStyleSection({ controller = visualStyleRuntime() }: { controller?: VisualStyleController | null }) {
  const { t } = useI18n();
  const style = useSyncExternalStore(controller?.subscribe ?? noop, () => controller?.getSnapshot() ?? "original", () => controller?.getSnapshot() ?? "original");
  const blur = useSyncExternalStore(controller?.subscribe ?? noop, () => controller?.getBlurSnapshot() ?? DEFAULT_GLASS_BLUR, () => controller?.getBlurSnapshot() ?? DEFAULT_GLASS_BLUR);
  return <div>
    <section className="lv-settings-theme-options flex flex-col gap-2">
      <h2 className="text-section-title text-ink">{t("settings.visualStyle.title")}</h2>
      <div role="group" aria-label={t("settings.visualStyle.title")} className="flex flex-col gap-2">
        {APPEARANCE_STYLES.map(value => <button type="button" key={value} aria-pressed={style === value}
          onClick={() => controller?.choose(value)} className="appearance-style-choice rounded-field border border-line p-3 text-left text-ink focus-visible:outline-brand-dark">
          <span aria-hidden="true" className="appearance-style-icon" data-style={value}><span /><span /></span>
          <span className="min-w-0 flex-1"><span className="block text-button font-medium">{t(`settings.visualStyle.${value}.name`)}</span>
            <span className="block text-helper text-muted">{t(`settings.visualStyle.${value}.note`)}</span></span>
          <span aria-hidden="true" className={style === value ? "text-brand-dark" : "invisible"}>✓</span>
        </button>)}
      </div>
      {style === "original" && <p className="text-helper text-muted">{t("settings.visualStyle.legacy")}</p>}
      <p className="text-helper text-muted">{t("settings.visualStyle.support")}</p>
    </section>
    <Reveal visible={style === "b1"}>
      <section className="lv-settings-theme-options flex flex-col gap-2">
        <h2 className="text-section-title text-ink">{t("settings.visualStyle.blur")}</h2>
        {/* 1.19.52：与“玻璃效果”三档同一种竖排（名称 + 一行说明）；按钮本身是瓷面（satin 显式候选，只在 B1 浅色手机外壳生效）。 */}
        <div role="group" aria-label={t("settings.visualStyle.blur")} className="flex flex-col gap-2">
          {B1_BLUR_PRESETS.map(value => <button type="button" key={value} aria-pressed={blur === value} onClick={() => controller?.chooseBlur(value)}
            {...materialAttributes("interactive", { finish: "satin" })}
            style={{ "--lv-material-radius": "var(--radius-field)" } as React.CSSProperties}
            className={`appearance-blur-choice lv-material lv-material-effects min-h-11 rounded-field px-3 py-2 text-left text-button outline-none focus-visible:outline-2 focus-visible:outline-brand-dark ${blur === value ? "bg-brand-soft text-brand-dark ring-1 ring-brand" : "bg-surface text-ink"}`}>
            <span className="block font-medium">{t(`settings.visualStyle.blur${value}`)}</span>
            <span className="block text-helper text-muted">{t(`settings.visualStyle.blurNote${value}`)}</span>
          </button>)}
        </div>
        {!B1_BLUR_PRESETS.some(value => value === blur) && <p className="text-helper text-muted">{t("settings.visualStyle.retainedBlur", { value: blur })}</p>}
      </section>
    </Reveal>
    <Reveal visible={style === "b2"}><B2GlassSection appearanceOnly /></Reveal>
    <Reveal visible={style !== "c" && style !== "original"}><WallpaperSection /></Reveal>
  </div>;
}
