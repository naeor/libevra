import { useSyncExternalStore } from "react";
import { ActionCard } from "../components/Card.js";
import { useI18n } from "../i18n/index.js";
import { visualStyleRuntime } from "../lib/visualStyle.js";
import { DEFAULT_WALLPAPER, WALLPAPERS, type Wallpaper } from "./wallpaper.js";

const noop = (): (() => void) => () => undefined;

export function WallpaperChoices({ selected, onChoose }: {
  selected: Wallpaper; onChoose: (wallpaper: Wallpaper) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return <section className="flex flex-col gap-2" aria-labelledby="wallpaper-title">
    <h2 id="wallpaper-title" className="text-section-title text-ink">{t("settings.wallpaper.title")}</h2>
    <div role="group" aria-labelledby="wallpaper-title" className="wallpaper-choices grid grid-cols-3 gap-2">
      {WALLPAPERS.map(id => <ActionCard key={id} className="wallpaper-choice min-w-0" aria-label={t(`settings.wallpaper.${id}`)} aria-pressed={selected === id} onClick={() => onChoose(id)}>
        <span className="lv-wallpaper-preview" data-wallpaper={id} aria-hidden="true">
          <span className="wallpaper-sample wallpaper-sample-main"><span /><span /></span>
          <span className="wallpaper-sample wallpaper-sample-list"><span /><span /><span /></span>
        </span>
        <span className="mt-2 flex items-start justify-between gap-1 text-helper font-medium">
          <span>{t(`settings.wallpaper.${id}`)}</span>
          <span aria-hidden="true" className={`shrink-0 text-brand-dark ${selected === id ? "visible" : "invisible"}`}>✓</span>
        </span>
      </ActionCard>)}
    </div>
    <p className="text-helper text-muted">{t("settings.wallpaper.note")}</p>
  </section>;
}

export function WallpaperSection(): React.JSX.Element | null {
  const controller = visualStyleRuntime();
  const selected = useSyncExternalStore(controller?.subscribe ?? noop, controller?.getWallpaperSnapshot ?? (() => DEFAULT_WALLPAPER), () => DEFAULT_WALLPAPER);
  return controller ? <WallpaperChoices selected={selected} onChoose={controller.chooseWallpaper} /> : null;
}
