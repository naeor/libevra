/**
 * 综合折算模式下的页面级说明条：统计货币、离线、加载 / 失败 / 重试、缺汇率的账目入口与原币统计。
 *
 * 这些原来在旧分析页的 `FxStats` 里，换成工作台后**一项都没丢**，只是从「一整页固定内容」改成
 * 工作台顶部的一条说明——卡片本身按同一个 `useFxRange` 结果显示数字（ACC-04 / ACC-07）。
 * 文案沿用 `fx.*`，不新写一套说法。
 */
import { Link } from "react-router";

import { useI18n } from "../i18n/index.js";
import { fxMoney } from "../lib/fxView.js";
import type { FxRangeView } from "./scope.js";

export function FxStatus({ fx }: { readonly fx: FxRangeView }): React.JSX.Element {
  const { t } = useI18n();
  const result = fx.result;
  const complete = result !== undefined && result.complete && fx.sourceComplete === true;
  return (
    <section className="mx-6 mt-3 flex flex-col gap-2 rounded-field border border-line bg-surface px-4 py-3" aria-label={t("fx.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-helper text-muted">
          {t("fx.target", { currency: fx.target })}
          {fx.offline === true ? ` · ${t("fx.offline")}` : ""}
        </p>
        <button type="button" className="sw-link" onClick={fx.refresh}>
          {t(fx.error === true ? "fx.retry" : "fx.refresh")}
        </button>
      </div>
      {fx.loading ? <p role="status" className="text-helper text-muted">{t("fx.loading")}</p> : null}
      {fx.error === true ? <p role="alert" className="text-helper text-danger">{t(fx.reason === "permission" ? "errors.api.book_forbidden" : fx.reason === "capacity" ? "fx.capacityError" : "fx.error")}</p> : null}
      {result !== undefined && !complete ? (
        <div role="alert" className="rounded-field bg-warn-soft px-3 py-2 text-helper-relaxed text-ink">
          <p className="font-medium">{t("fx.incomplete")}</p>
          <p>{t("fx.subtotal")}</p>
          {fx.sourceComplete === true ? null : <p>{t("fx.dataIncomplete")}</p>}
          {result.missingCount > 0 ? <p>{t("fx.missing", { count: result.missingCount })}</p> : null}
        </div>
      ) : null}
      {result !== undefined && result.reviewNeededCount > 0 ? <p className="text-helper text-warn-dark">{t("fx.review")}</p> : null}
      {result !== undefined && result.failures.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-helper text-ink">
            {t("fx.showMissing")} ({result.missingCount})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {result.failures.map((row) => (
              <li key={row.id} className="text-helper-relaxed text-muted">
                <Link className="text-brand-dark underline" to={`/transactions/${encodeURIComponent(row.id)}`}>
                  {row.date} · {row.currency}
                </Link>{" "}
                · {t(`fx.reasons.${row.reason}`)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {result !== undefined ? (
        <details>
          <summary className="cursor-pointer text-helper text-ink">{t("fx.originalTotals")}</summary>
          {Object.entries(result.originalByCurrency).map(([currency, totals]) => (
            <p key={currency} className="mt-1.5 text-helper-relaxed text-muted">
              {currency} · {t("fx.expense")} {fxMoney(totals.expenseMinor, currency)} · {t("fx.income")} {fxMoney(totals.incomeMinor, currency)}
            </p>
          ))}
        </details>
      ) : null}
      <p className="text-helper text-muted">
        {t("fx.source")} · {t("fx.reference")}
      </p>
    </section>
  );
}
