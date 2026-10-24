import { useSyncExternalStore } from "react";
import { InnerPage } from "../components/Layouts.js";
import { useI18n } from "../i18n/index.js";
import { ThemePreview } from "../components/ThemePreview.js";
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

/**
 * The appearance screen's presentation, separate from the browser runtime so it
 * can be rendered and inspected without a DOM.
 *
 * ⚠️ **The previews are here, above the controls, on purpose.** The owner asked
 * for a page where choosing a theme is a visual decision rather than a list of
 * colour names. They use the same tokens as the product, so no preview-specific
 * palette is maintained.
 *
 * ⚠️ **Nothing here is a fixed-height page.** The preview height follows the
 * viewport (`dvh`) with a normal `vh` fallback; on a short phone it shrinks
 * first, and the page remains scrollable if a larger text size still does not
 * fit. Controls are never clipped to force the first screen.
 */
export function ThemeAppearanceView({
  preference,
  onChoose,
}: {
  readonly preference: ThemePreference;
  readonly onChoose: (next: Partial<ThemePreference>) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const paletteLabel = (palette: ThemePalette): string => t(`settings.theme.palettes.${palette}`);
  const selectedPaletteLabel = paletteLabel(preference.palette);

  return (
    <div className="appearance-settings flex flex-col gap-5 pb-[env(safe-area-inset-bottom,0px)]">
      <section aria-label={t("settings.theme.previews")} className="appearance-previews grid grid-cols-2 gap-3">
        {(["space", "detail"] as const).map((kind) => (
          <div
            key={kind}
            className="appearance-preview min-w-0 overflow-hidden rounded-field border border-line/60"
          >
            <ThemePreview kind={kind} />
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-section-title text-ink">{t("settings.theme.mode")}</h2>
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

      <section className="flex flex-col gap-2">
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
    <InnerPage title={t("settings.theme.title")} backTo="/settings/appearance">
      <ThemeAppearanceView preference={preference} onChoose={(next) => controller.choose(next)} />
    </InnerPage>
  );
}

export { MODES as THEME_MODES_UI, PALETTES as THEME_PALETTES_UI };
