import { useState, useSyncExternalStore } from "react";
import { InnerPage } from "../components/Layouts.js";
import { useI18n } from "../i18n/index.js";
import { ThemePreview } from "../components/ThemePreview.js";
import { AppearanceStyleSection } from "./AppearanceStyleSection.js";
import { BottomSheet } from "../components/BottomSheet.js";
import "./theme-appearance.css";
import {
  AVAILABLE_THEME_PALETTES,
  startThemeRuntime,
  type ThemeMode,
  type ThemePalette,
  type ThemePreference,
} from "../lib/theme.js";

/** 顺序即界面顺序；名称在 `settings.theme.modes.*` / `settings.theme.palettes.*`，渲染时按当前语言取。 */
const MODES: readonly ThemeMode[] = ["system", "light", "dark"];

const PALETTES: readonly ThemePalette[] = ["green", "yellow", "orange", "blue", "purple", "red", "cyan"];

export function ThemeAppearanceView({
  preference,
  onChoose,
}: {
  readonly preference: ThemePreference;
  readonly onChoose: (next: Partial<ThemePreference>) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const paletteLabel = (palette: ThemePalette): string => t(`settings.theme.palettes.${palette}`);
  const [preview, setPreview] = useState(false);
  const [kind, setKind] = useState<"space" | "detail">("space");
  const selectedPaletteLabel = paletteLabel(preference.palette);

  return (
    <div className="appearance-settings flex flex-col gap-5 pb-[env(safe-area-inset-bottom,0px)]">
      <section className="lv-settings-theme-options flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3"><h2 className="text-section-title text-ink">{t("settings.theme.mode")}</h2>
      <button type="button" onClick={() => setPreview(true)} className="min-h-11 self-start rounded-field px-3 text-button text-brand-dark focus-visible:outline-brand-dark">{t("settings.visualStyle.preview")}</button>
      </div>
        <div role="group" aria-label={t("settings.theme.mode")} className="grid grid-cols-3 gap-1 rounded-field bg-surface p-1">
          {MODES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={preference.mode === value}
              onClick={() => onChoose({ mode: value })}
              className={`min-h-11 rounded-field px-1 py-2 text-button font-medium outline-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark ${
                preference.mode === value
                  ? "bg-brand-soft text-brand-dark shadow-card ring-1 ring-brand"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t(`settings.theme.modes.${value}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="lv-settings-theme-options flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-section-title text-ink">{t("settings.theme.palette")}</h2>
          <span aria-live="polite" className="text-helper text-muted">
            {selectedPaletteLabel}
          </span>
        </div>
        <div role="group" aria-label={t("settings.theme.palette")} className="grid grid-cols-7">
          {PALETTES.filter((value) => AVAILABLE_THEME_PALETTES.includes(value)).map((value) => {
            const selected = preference.palette === value;
            const label = paletteLabel(value);
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                aria-label={t("settings.theme.switchTo", { name: label })}
                title={label}
                onClick={() => onChoose({ palette: value })}
                className="flex min-h-11 min-w-0 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
              >
                <span
                  aria-hidden="true"
                  data-theme-palette={value}
                  className={`theme-swatch block size-6 rounded-full bg-brand ${
                    selected
                      ? "ring-2 ring-brand-dark ring-offset-2 ring-offset-canvas"
                      : "ring-1 ring-line/70 ring-offset-0"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </section>

      <AppearanceStyleSection />
      {preview && <BottomSheet label={t("settings.theme.previews")} onClose={() => setPreview(false)} dialogClassName="appearance-preview-sheet">
        {close => <>
          <div className="flex shrink-0 items-center justify-between gap-3 p-4">
            <h2 className="text-section-title text-ink">{t("settings.theme.previews")}</h2>
            <button type="button" onClick={close} className="min-h-11 px-3 text-button text-brand-dark">{t("common.action.close")}</button>
          </div>
          <div role="group" aria-label={t("settings.theme.previews")} className="mx-4 mb-3 grid grid-cols-2 gap-2">
            {(["space", "detail"] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)} className={`min-h-11 rounded-field text-button ${kind === value ? "bg-brand-soft text-brand-dark" : "text-muted"}`}>{t(`settings.visualStyle.preview${value}`)}</button>)}
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4"><ThemePreview kind={kind} /></div>
          <p className="shrink-0 px-4 pb-3 text-helper text-muted">{t("settings.visualStyle.sample")}</p>
        </>}
      </BottomSheet>}
    </div>
  );
}

export function ThemeAppearancePage(): React.JSX.Element {
  const controller = startThemeRuntime();
  const preference = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { t } = useI18n();
  // Keep the page title when Safari's toolbar makes the viewport short; the
  // title is the only large heading and is not repeated in a card.
  return (
    <InnerPage title={t("settings.theme.title")} backTo="/settings">
      <ThemeAppearanceView preference={preference} onChoose={(next) => controller.choose(next)} />
    </InnerPage>
  );
}

export { MODES as THEME_MODES_UI, PALETTES as THEME_PALETTES_UI };
