import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAuthOptional } from "../auth/AuthProvider.js";
import { useI18n } from "../i18n/index.js";
import { useAdminEntry } from "../lib/admin.js";
import { STYLE_LAB_ENABLED, visualStyleRuntime, type VisualStyleController } from "../lib/visualStyle.js";
import { B2_GLASS_DEFAULT, B2_GLASS_FIELDS, B2_GLASS_PRESET_NAMES, type B2GlassSelection, type B2GlassPreset, type B2GlassValues } from "./b2Glass.js";
import { createB2AdminEditor } from "./b2Admin.js";
import { materialAttributes } from "./material.js";
import "./material-components.css";

const FIELD_RADIUS = { "--lv-material-radius": "var(--radius-field)" } as React.CSSProperties;

const noop = (): (() => void) => () => undefined;
const choiceClass = (selected: boolean): string => `min-h-11 rounded-field px-3 py-2 text-left text-button outline-none focus-visible:outline-2 focus-visible:outline-brand-dark ${selected ? "bg-brand-soft text-brand-dark ring-1 ring-brand" : "bg-surface text-ink"}`;

export function B2PresetChoices({ selection, onChoose }: { selection: B2GlassSelection; onChoose: (preset: B2GlassPreset) => void }): React.JSX.Element {
  const { t } = useI18n();
  return <div role="group" aria-label={t("settings.glass.title")} className="flex flex-col gap-2">
    {/* 1.19.53：S19 浅色手机里是交互卡材质（原来是不透明白片），选中态为统一选中描边。 */}
    {B2_GLASS_PRESET_NAMES.map(key => <button key={key} type="button" aria-pressed={selection.mode === key} onClick={() => onChoose(key)}
      {...materialAttributes("interactive")} style={FIELD_RADIUS} className={`lv-material ${choiceClass(selection.mode === key)}`}>
      <span className="block font-medium">{t(`settings.glass.presets.${key}.name`)}</span>
      <span className="block text-helper text-muted">{t(`settings.glass.presets.${key}.note`)}</span>
    </button>)}
    {selection.mode === "custom" && <p className="text-helper text-muted" role="status">{t("settings.glass.custom")}</p>}
  </div>;
}

function AdvancedGlass({ controller, accountId, accountNumber, selection }: {
  controller: VisualStyleController; accountId: string; accountNumber: string; selection: B2GlassSelection;
}): React.JSX.Element | null {
  // 沿用双层入口判断，身份切换由外层 key 卸载此实例；不改原权限函数。
  const permitted = useAdminEntry(accountNumber);
  const { t } = useI18n();
  const editor = useMemo(() => createB2AdminEditor(controller, accountId, accountNumber), [controller, accountId, accountNumber]);
  const [draft, setDraft] = useState(selection.values);
  const [error, setError] = useState(false);
  useEffect(() => { setDraft(selection.values); setError(false); editor.cancel(); }, [selection, editor]);
  useEffect(() => () => editor.cancel(), [editor]);
  if (!permitted) return null;
  const change = (key: keyof B2GlassValues, value: number): void => {
    if (!permitted) return;
    const next = { ...draft, [key]: value };
    setDraft(next); setError(false);
    void editor.choose(next).then(result => {
      if (result === "denied") { setDraft(controller.getB2Snapshot().values); setError(true); }
    });
  };
  return <details className="rounded-field bg-surface p-3" data-b2-admin="">
    <summary className="cursor-pointer text-section-title text-ink">{t("settings.glass.advanced")}</summary>
    <p className="my-2 text-helper text-muted">{t("settings.glass.accountOnly")}</p>
    {B2_GLASS_FIELDS.map(key => <label key={key} className="my-2 flex flex-col text-helper text-muted">
      <span className="flex justify-between"><span>{t(`settings.glass.fields.${key}`)}</span><output>{draft[key]}{key === "blur" ? " / 100" : "%"}</output></span>
      <input type="range" min="0" max="100" step="1" value={draft[key]} aria-label={t(`settings.glass.fields.${key}`)} onChange={event => change(key, Number(event.currentTarget.value))} className="min-h-11 w-full accent-brand" />
    </label>)}
    <button type="button" className="min-h-11 text-button text-brand-dark" onClick={() => { editor.cancel(); controller.chooseB2Preset("balanced"); }}>{t("settings.glass.reset")}</button>
    {error && <p role="alert" className="text-helper text-danger">{t("settings.glass.denied")}</p>}
  </details>;
}

/** 正式外观入口：普通用户三档；高级编辑通过真实管理员入口与写入前复核。 */
export function B2GlassSection({ appearanceOnly = false }: { appearanceOnly?: boolean } = {}): React.JSX.Element | null {
  const controller = visualStyleRuntime();
  const auth = useAuthOptional();
  const { t } = useI18n();
  const style = useSyncExternalStore(controller?.subscribe ?? noop, () => controller?.getSnapshot() ?? "original", () => "original");
  const selection = useSyncExternalStore(controller?.subscribe ?? noop, () => controller?.getB2Snapshot() ?? B2_GLASS_DEFAULT, () => B2_GLASS_DEFAULT);
  if (!controller) return null;
  return <>
    {!appearanceOnly && !STYLE_LAB_ENABLED && <section className="lv-settings-theme-options flex flex-col gap-2">
      <h2 className="text-section-title text-ink">{t("settings.glass.style")}</h2>
      <div role="group" aria-label={t("settings.glass.style")} className="grid grid-cols-2 gap-2">
        {(["original", "b2"] as const).map(value => <button type="button" key={value} aria-pressed={style === value} onClick={() => controller.choose(value)} className={choiceClass(style === value)}>{t(`settings.glass.styles.${value}`)}</button>)}
      </div>
      <p className="text-helper text-muted">{t("settings.glass.phoneLight")}</p>
    </section>}
    {(style === "b2" || appearanceOnly) && <section className="lv-settings-theme-options flex flex-col gap-2" data-b2-glass="">
      <h2 className="text-section-title text-ink">{t("settings.glass.title")}</h2>
      <B2PresetChoices selection={selection} onChoose={preset => controller.chooseB2Preset(preset)} />
      <p className="text-helper text-muted">{t("settings.glass.saved")}</p>
      {auth?.user && <AdvancedGlass key={auth.user.id} controller={controller} accountId={auth.user.id} accountNumber={auth.user.accountNumber} selection={selection} />}
    </section>}
  </>;
}
