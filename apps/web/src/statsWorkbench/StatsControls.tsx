/**
 * 分析主页的统计控制区（1.17.12 精简）。
 *
 * 默认只占一行：**当前统计币种与方式、刷新统计、展开其它设置的次级入口**。统计方式切换、币种、
 * 数据来源与汇率说明、原币合计、未折算账目清单、完整性说明全部移进「统计设置」面板——能力一项不少，
 * 只是不再长期占据主页。
 *
 * ⚠️ **不靠隐藏警告换来干净**：缺汇率影响结果、读取失败、本机数据不完整时，控制条下方仍然有一行
 * 状态提示（点开看详情）；只有一切正常时才只剩一行。
 */
import { CURRENCIES, type Currency } from "@libellum/shared";
import { useMemo } from "react";

import { BottomSheet } from "../components/BottomSheet.js";
import { SyncControls } from "./SyncControls.js";
import { useI18n } from "../i18n/index.js";
import { currencyName } from "../lib/format.js";
import { FxStatus } from "./FxStatus.js";
import type { WorkbenchScope } from "./scope.js";
import { SheetHeader } from "./Sheets.js";
import { RefreshGlyph, SlidersGlyph } from "./ui.js";

/** 控制条下方要不要显示状态提示：只在结果受影响时（缺汇率、读取失败、本机数据不完整）。 */
export function statusNotice(scope: WorkbenchScope): "error" | "incomplete" | "loading" | null {
  const fx = scope.fx;
  if (fx === null) return null;
  if (fx.error === true) return "error";
  if (fx.loading) return "loading";
  const result = fx.result;
  if (result !== undefined && !(result.complete && fx.sourceComplete === true)) return "incomplete";
  return null;
}

export function StatBar({ scope, onSettings }: { readonly scope: WorkbenchScope; readonly onSettings: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const fx = scope.fx;
  const mode = scope.combined ? t("statsWorkbench.controls.combined") : t("statsWorkbench.controls.original");
  const notice = statusNotice(scope);
  return (
    <div className="mx-6 mt-3 flex flex-col gap-2">
      <div className="sw-statbar">
        <button type="button" className="sw-statbar-main" onClick={onSettings} aria-label={t("statsWorkbench.controls.openSettings", { currency: scope.currency, mode })}>
          <span className="sw-statbar-currency">{scope.currency}</span>
          <span className="min-w-0 truncate text-helper text-muted">
            {mode}
            {fx?.offline === true ? ` · ${t("fx.offline")}` : ""}
          </span>
        </button>
        {fx === null ? null : (
          <button type="button" className="sw-statbar-action" onClick={fx.refresh} disabled={fx.loading}>
            <RefreshGlyph width={16} height={16} className={fx.loading ? "sw-spin" : ""} aria-hidden="true" />
            <span>{t(fx.error === true ? "fx.retry" : "fx.refresh")}</span>
          </button>
        )}
        <button type="button" className="sw-icon-button sw-statbar-settings" aria-label={t("statsWorkbench.controls.settings")} onClick={onSettings}>
          <SlidersGlyph width={18} height={18} />
        </button>
      </div>
      {notice === null || notice === "loading" ? (
        notice === "loading" ? <p role="status" className="px-1 text-helper text-muted">{t("fx.loading")}</p> : null
      ) : (
        <button type="button" role="alert" className="sw-statbar-notice" onClick={onSettings}>
          <span className="min-w-0 flex-1 text-left">
            {notice === "error"
              ? t(fx?.reason === "permission" ? "errors.api.book_forbidden" : fx?.reason === "capacity" ? "fx.capacityError" : "fx.error")
              : fx?.result !== undefined && fx.result.missingCount > 0
                ? t("statsWorkbench.controls.missingShort", { count: fx.result.missingCount })

                : t("statsWorkbench.controls.incompleteShort")}
          </span>
          <span className="shrink-0 text-brand-dark">{t("statsWorkbench.controls.details")}</span>
        </button>
      )}
    </div>
  );
}

/**
 * 「统计设置」：统计方式（综合折算 / 原币）与币种立即生效（写地址栏，与筛选面板同一组参数）；
 * 下面是来源、原币合计、未折算账目与完整性说明（沿用 `FxStatus`，详情页也用它）。
 */
export function StatsSettingsSheet({
  scope,
  currenciesInLedger,
  onChoose,
  onClose,
}: {
  readonly scope: WorkbenchScope;
  readonly currenciesInLedger: readonly string[];
  readonly onChoose: (choice: { readonly combined: boolean; readonly currency: Currency | null }) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const defaultCurrency = scope.defaultCurrency;
  const currencies = useMemo(() => {
    // 只列账本里出现过的币种（加上默认币种与当前币种）；其它币种仍可在筛选面板里选。
    const preferred = new Set<string>([defaultCurrency, scope.currency, ...currenciesInLedger]);
    return [...CURRENCIES].filter((currency) => preferred.has(currency)).sort((a, b) => (a === defaultCurrency ? -1 : b === defaultCurrency ? 1 : 0));
  }, [defaultCurrency, currenciesInLedger, scope.currency]);
  const fxTarget = scope.combined ? scope.currency : defaultCurrency;
  return (
    <BottomSheet label={t("statsWorkbench.controls.settingsTitle")} onClose={onClose} dialogClassName="sm:max-w-md">
      {(close) => (
        <>
          <SheetHeader title={t("statsWorkbench.controls.settingsTitle")} />
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <SyncControls />
            <section className="flex flex-col gap-2" aria-labelledby="sw-settings-mode">
              <h3 id="sw-settings-mode" className="text-helper font-medium text-muted">{t("statsWorkbench.controls.modeTitle")}</h3>
              <div className="flex flex-wrap gap-2">
                {scope.fxAvailable ? (
                  <button type="button" aria-pressed={scope.combined} className={`sw-chip ${scope.combined ? "sw-chip-on" : ""}`} onClick={() => onChoose({ combined: true, currency: null })}>
                    {t("statsWorkbench.filter.combinedOption", { currency: fxTarget })}
                  </button>
                ) : null}
                {currencies.map((currency) => {
                  const on = !scope.combined && scope.currency === currency;
                  return (
                    <button key={currency} type="button" aria-pressed={on} className={`sw-chip ${on ? "sw-chip-on" : ""}`} onClick={() => onChoose({ combined: false, currency: currency === defaultCurrency ? null : (currency as Currency) })}>
                      {currencyName(currency)}
                    </button>
                  );
                })}
              </div>
              <p className="text-helper-relaxed text-muted">
                {scope.combined ? t("statsWorkbench.filter.combinedHint", { currency: currencyName(fxTarget) }) : t("statsWorkbench.controls.originalHint", { currency: currencyName(scope.currency) })}
              </p>
            </section>

            {scope.fx === null ? null : (
              <section className="flex flex-col gap-2" aria-labelledby="sw-settings-source">
                <h3 id="sw-settings-source" className="text-helper font-medium text-muted">{t("statsWorkbench.controls.sourceTitle")}</h3>
                <FxStatus fx={scope.fx} embedded />
              </section>
            )}

            {scope.coverageGap === null ? null : (
              <section className="flex flex-col gap-2" aria-labelledby="sw-settings-coverage">
                <h3 id="sw-settings-coverage" className="text-helper font-medium text-muted">{t("statsWorkbench.controls.coverageTitle")}</h3>
                <p className="rounded-field bg-warn-soft px-4 py-3 text-helper-relaxed text-ink">
                  {scope.repairing ? t("statsWorkbench.coverage.repairing") : t("statsWorkbench.coverage.gap", { server: scope.coverageGap.server, local: scope.coverageGap.local })}
                </p>
              </section>
            )}

            <button type="button" className="sw-pill" onClick={close}>{t("statsWorkbench.controls.close")}</button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
