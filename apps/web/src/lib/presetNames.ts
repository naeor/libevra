/**
 * **系统默认分类 / 支付方式的显示名（S16 国际化）。**
 *
 * ⚠️ **只翻译“显示”，从不改数据。** 新账本的默认分类、支付方式由 `@libellum/shared` 的中文名写进数据库，
 * 数据库里没有稳定的“预置项 ID”，本轮也不改数据库结构、不批量改用户数据。所以规则是：
 *
 *   - 名字与某个**预置中文名完全相同** → 英文界面显示对应英文（`餐饮` → `Food & drink`）；
 *   - 用户改过名、或自己建的分类 → 原样显示，任何语言下都不翻译；
 *   - **编辑框、提交给服务器的值、导入导出、搜索匹配一律使用原名**，绝不用这里的显示名。
 *
 * 中文界面下这些函数原样返回，行为与以前完全一致。
 */
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHOD_NAMES,
  UNCATEGORISED_NAME,
} from "@libellum/shared";

import { isChineseLocale, t } from "../i18n/index.js";
import type zhPresets from "../i18n/resources/zh-CN/presets.js";

type PresetCategoryName = keyof typeof zhPresets.category;
type PresetPaymentName = keyof typeof zhPresets.paymentMethod;
type ExpenseDescriptionName = keyof typeof zhPresets.categoryDescription.expense;
type IncomeDescriptionName = keyof typeof zhPresets.categoryDescription.income;

const CATEGORY_NAMES: ReadonlySet<string> = new Set<string>([
  ...EXPENSE_CATEGORIES.map((preset) => preset.name),
  ...INCOME_CATEGORIES.map((preset) => preset.name),
  UNCATEGORISED_NAME,
]);

const PAYMENT_NAMES: ReadonlySet<string> = new Set<string>(PAYMENT_METHOD_NAMES);

/** 分类名用于**显示**时调用。不要把返回值写进输入框或请求。 */
export function displayCategoryName(name: string): string {
  if (isChineseLocale() || !CATEGORY_NAMES.has(name)) return name;
  return t(`presets.category.${name as PresetCategoryName}`);
}

/** 支付方式名用于**显示**时调用。不要把返回值写进输入框或请求。 */
export function displayPaymentMethodName(name: string): string {
  if (isChineseLocale() || !PAYMENT_NAMES.has(name)) return name;
  return t(`presets.paymentMethod.${name as PresetPaymentName}`);
}

/**
 * 分类说明用于显示：只有当说明**仍是预置原文**时才翻译，用户改过的说明原样显示。
 */
export function displayCategoryDescription(
  name: string,
  kind: "expense" | "income",
  description: string | null | undefined,
): string | null {
  if (description === null || description === undefined) return null;
  if (isChineseLocale()) return description;
  if (name === UNCATEGORISED_NAME && description === "未选择分类的记账") {
    return t("presets.categoryDescription.暂无分类");
  }
  const presets = kind === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const preset = presets.find((item) => item.name === name);
  if (preset === undefined || preset.description !== description) return description;
  return kind === "expense"
    ? t(`presets.categoryDescription.expense.${name as ExpenseDescriptionName}`)
    : t(`presets.categoryDescription.income.${name as IncomeDescriptionName}`);
}
