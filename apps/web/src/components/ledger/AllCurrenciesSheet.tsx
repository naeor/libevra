import { CURRENCIES, type CurrencySummary } from "@libellum/shared";

import { BottomSheet } from "../BottomSheet.js";
import { useI18n } from "../../i18n/index.js";
import { currencyName, formatMoney } from "../../lib/format.js";

/**
 * **全部币种**：账号能用的每一种币种，包括这个月份没有账目的（明细页摘要卡片的「全部币种」入口）。
 *
 * 1.19.59 从 `pages/DetailPage.tsx` 抽成独立组件，外壳换成弹出面板模板的 T4 信息说明：按内容高度
 * （1.19.63 起最高到大档，币种更多时在面板里滚动）、模板标题行与右上角 ×；原来缺的 `aria-modal`、Esc、焦点与
 * 下拉关闭由外壳补上，列表底部重复的「关闭」去掉。宽屏下仍一直贴底（`wide="bottom"`，与原来相同）。
 * 列表内容与金额显示不变。
 */
export function AllCurrenciesSheet({
  currencies,
  mainCode,
  allMonths = false,
  onClose,
}: {
  readonly currencies: readonly CurrencySummary[];
  readonly mainCode: string;
  readonly allMonths?: boolean;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <BottomSheet
      label={t("ledger.detail.allCurrencies")}
      title={t("ledger.detail.allCurrencies")}
      detent="content"
      wide="bottom"
      bodyClassName="px-6 pt-1 pb-6"
      onClose={onClose}
    >
      <ul className="flex flex-col gap-2">
        {CURRENCIES.map((code) => {
          const row = currencies.find((item) => item.currency === code);

          return (
            <li key={code} className="flex items-center justify-between gap-3 rounded-field bg-canvas px-4 py-3">
              <span className="min-w-0 text-sm text-ink">
                {currencyName(code)}
                {code === mainCode ? (
                  <span className="ml-2 text-xs text-muted">{t("ledger.detail.mainCurrency")}</span>
                ) : null}
              </span>

              {row === undefined ? (
                <span className="shrink-0 text-xs text-muted">{allMonths ? t("ledger.detail.noData") : t("ledger.detail.nothingThisMonth")}</span>
              ) : (
                <span className="shrink-0 text-sm tabular-nums text-ink">
                  {formatMoney(row.expenseCents, row.currency)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
