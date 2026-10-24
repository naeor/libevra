import { CURRENCIES, type Currency } from "@libellum/shared";

import { useI18n } from "../../i18n/index.js";
import { currencyName } from "../../lib/format.js";
import { ChoiceSheet } from "../ui/ChoiceSheet.js";

/**
 * 币种选择面板（`/add` 金额框右侧的入口）。
 *
 * ⚠️ **选项就是 `CURRENCIES`，一个不多一个不少**：这是一个封闭集合，
 * 币种决定精度（`decimalsFor`）与保存时的数据形状，不能在前端自己加。
 * 本组件只负责"选哪一个"，不换算汇率、不改金额文本——那些规则仍在页面里。
 *
 * 面板本身是通用的 `ChoiceSheet`（底部面板 + listbox 语义 + 安全区），
 * 账本导入的来源/目标选择用的是同一个组件，避免两套选择器慢慢长得不一样。
 */
export function CurrencySheet({
  open,
  currency,
  onSelect,
  onClose,
}: {
  readonly open: boolean;
  readonly currency: Currency;
  readonly onSelect: (currency: Currency) => void;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const { t } = useI18n();

  return (
    <ChoiceSheet
      open={open}
      title={t("entry.currencySheet.title")}
      value={currency}
      options={CURRENCIES.map((code) => ({
        value: code,
        label: currencyName(code),
        // 右侧保留代码：人民币 / CNY 一对，读者用哪种叫法都认得。
        trailing: code,
      }))}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}
