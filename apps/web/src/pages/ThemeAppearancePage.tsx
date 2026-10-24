import { useSyncExternalStore } from "react";
import { InnerPage } from "../components/Layouts.js";
import { AVAILABLE_THEME_PALETTES, startThemeRuntime, type ThemeMode, type ThemePalette } from "../lib/theme.js";

const MODES: readonly { value: ThemeMode; label: string }[] = [
  { value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" },
];
const PALETTES: readonly { value: ThemePalette; label: string }[] = [
  { value: "red", label: "红色" }, { value: "orange", label: "橙色" },
  { value: "yellow", label: "黄色" }, { value: "green", label: "绿色" },
  { value: "cyan", label: "青色" }, { value: "blue", label: "蓝色" }, { value: "purple", label: "紫色" },
];

export function ThemeAppearancePage(): React.JSX.Element {
  const controller = startThemeRuntime();
  const preference = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return (
    <InnerPage title="外观" backTo="/settings/appearance">
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <section className="flex flex-col gap-3 p-5">
          <h2 className="text-card-title text-ink">外观模式</h2>
          <div role="group" aria-label="外观模式" className="grid grid-cols-3 gap-1 rounded-field bg-canvas p-1">
            {MODES.map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={preference.mode === value}
                onClick={() => controller.choose({ mode: value })}
                className={`min-h-11 rounded-field px-1 py-2 text-button font-medium outline-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark ${preference.mode === value ? "bg-brand-soft text-brand-dark shadow-card ring-1 ring-brand" : "text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-3 border-t border-line p-5">
          <h2 className="text-card-title text-ink">主题色</h2>
          <div role="group" aria-label="主题色" className="flex flex-wrap gap-3">
            {PALETTES.filter(({ value }) => AVAILABLE_THEME_PALETTES.includes(value)).map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={preference.palette === value}
                onClick={() => controller.choose({ palette: value })}
                className="inline-flex min-h-11 items-center gap-2 rounded-field border border-brand bg-brand-soft px-3 py-2 text-button text-brand-dark outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark">
                <span aria-hidden="true" className="size-6 rounded-full bg-brand" />{label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </InnerPage>
  );
}
