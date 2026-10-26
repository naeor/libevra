import { useNavigate } from "react-router";
import { FxModeSetting } from "../components/FxDisplay.js";

import { DuplicateDetectionSettingsCard } from "../components/DuplicateDetectionSettings.js";
import { InnerPage } from "../components/Layouts.js";
import {
  CurrencyQuickPick,
  SettingsRowList,
  useDefaultCurrency,
} from "../components/SettingsCard.js";
import { LOCALE_NATIVE_NAMES, useI18n } from "../i18n/index.js";
import { useLanguagePreference } from "../lib/languageRuntime.js";

/**
 * **设置的三张分类子页面（S13-E 之后的设置首页把它们各自变成一页）。**
 *
 * ⚠️ **Why sub-pages at all.** The old `/settings` was one long column: ten real
 * controls and ten 「后续开放」 rows, every group expanded at once. The owner's
 * instruction for this round was to turn it into **设置首页 + 分类子页面 + 少量快捷操作**,
 * so the home lists five categories and each category owns its own short screen.
 *
 * ⚠️ **The addresses are real routes** (`/settings/preferences`, `/settings/appearance`,
 * `/settings/security`) and each page's back falls back to `/settings` — so a
 * refresh or a shared deep link lands on the page itself instead of the wildcard
 * redirect, and back returns one step rather than all the way to 我的.
 *
 * ⚠️ **What is *not* here matters too.** 导出数据 / 导入历史账 were moved to the
 * **book's** settings in the previous round; they belong to one ledger and must not
 * come back to an account-level screen (owner's S13-E ruling). 语言 / 主题色 / 汇率折算
 * are genuinely not built yet, and they say so on the page they belong to.
 */

/** Every sub-page leaves the same way: to the settings home, history first. */
function SettingsSubPage({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <InnerPage title={title} backTo="/settings">
      {children}
    </InnerPage>
  );
}

/**
 * `/settings/preferences` — 记账偏好.
 *
 * 默认币种只在本页展开；原 CurrencyQuickPick、useDefaultCurrency 与 PATCH 路径不变。
 * 首页不再挂载币种控件；本页仍以 PATCH 回答更新当前选择，没有第二套币种状态。
 */
export function PreferencesPage(): React.JSX.Element {
  const navigate = useNavigate();
  const currency = useDefaultCurrency();
  const { t } = useI18n();

  return (
    <SettingsSubPage title={t("settings.preferences.title")}>
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-section-title text-ink">{t("settings.preferences.defaultCurrency")}</h2>

        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
          <CurrencyQuickPick
            value={currency}
            hint={t("settings.preferences.defaultCurrencyHint")}
          />
        </div>
      </section>

      {/**
       * ⚠️ **S15-E2：重复交易检测的提醒开关与规则。**
       *
       * 这是设置页里的**一节**，没有新增二级页面、没有改导航。值存在设备本地并
       * 按账号隔离（见 `lib/duplicateSettings.ts`）；关闭提醒只关闭业务层提示，
       * 不影响幂等、来源去重、权限与离线同步。
       */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-section-title text-ink">{t("settings.preferences.duplicates")}</h2>

        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
          <DuplicateDetectionSettingsCard />
        </div>
      </section>

      {/**
       * ⚠️ **These five are genuinely not built yet, and the rows say 「后续开放」.**
       * The owner's rule: a settings screen may list a future item, but it must read
       * as a stated fact rather than as an entry that silently does nothing.
       */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-section-title text-ink">{t("settings.preferences.entryAndLayout")}</h2>
        <SettingsRowList
          rows={[
            { label: t("settings.preferences.largeKeypad.label"), hint: t("settings.preferences.largeKeypad.hint") },
            { label: t("settings.preferences.reuseLast.label"), hint: t("settings.preferences.reuseLast.hint") },
            { label: t("settings.preferences.startRecording.label"), hint: t("settings.preferences.startRecording.hint") },
            { label: t("settings.preferences.currencyOrder.label"), hint: t("settings.preferences.currencyOrder.hint") },
            { label: t("settings.preferences.buttonPosition.label"), hint: t("settings.preferences.buttonPosition.hint") },
          ]}
          onNavigate={(to) => void navigate(to)}
        />
      </section>
    </SettingsSubPage>
  );
}

/**
 * `/settings/appearance` — 显示与数据.
 *
 * 语言 / 外观 / 汇率折算。语言（S16 国际化）与外观各有自己的选择页，汇率折算仍为占位。
 * 语言行的说明直接写出当前语言的自称，切到看不懂的语言也能认出这一行。
 * Export and import are **not** listed here: the audit
 * caught them labelled 「后续开放」 while the pages already existed, and the S13-E
 * decision moved them to 账本设置 → 数据管理, where the data they act on lives.
 */
export function AppearancePage(): React.JSX.Element {
  const navigate = useNavigate();
  const { t } = useI18n();
  const language = useLanguagePreference();

  return (
    <SettingsSubPage title={t("settings.appearance.title")}>
      <SettingsRowList
        rows={[
          {
            label: `${t("language.title")}${language.locale === "en-US" ? "" : " / Language"}`,
            hint:
              language.preference === "system"
                ? `${t("language.system")} · ${LOCALE_NATIVE_NAMES[language.locale]}`
                : LOCALE_NATIVE_NAMES[language.locale],
            to: "/settings/appearance/language",
          },
          { label: t("settings.appearance.theme.label"), hint: t("settings.appearance.theme.hint"), to: "/settings/appearance/theme" },
        ]}
        onNavigate={(to) => void navigate(to)}
      />
      <FxModeSetting />
    </SettingsSubPage>
  );
}

/**
 * `/settings/security` — 账号安全.
 *
 * ⚠️ **Three rows, each a real page; none of them changed in this round.**
 * 更改密码 (`/settings/password`), 生成新的恢复码 (`/settings/recovery-code`) and
 * 邀请码 (`/settings/referral-codes`) keep their own screens, their own server
 * rules and their own audit. This page is only where they are listed now.
 *
 * ⚠️ **`state.from` is passed with each move**, so the page behind the row knows
 * it was opened from **账号安全** rather than from the settings home. Those pages
 * already honour a declared origin (`useGoBack`), so back returns here instead of
 * skipping a level — the same mechanism that fixed the 关于/设置 bounce.
 */
export function SecurityPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { t } = useI18n();

  const open = (to: string): void => {
    void navigate(to, { state: { from: "/settings/security" } });
  };

  return (
    <SettingsSubPage title={t("settings.security.title")}>
      <SettingsRowList
        rows={[
          {
            label: t("settings.security.password.label"),
            hint: t("settings.security.password.hint"),
            to: "/settings/password",
          },
          {
            label: t("settings.security.recoveryCode.label"),
            hint: t("settings.security.recoveryCode.hint"),
            to: "/settings/recovery-code",
          },
          /**
           * ⚠️ **The referral code stays here, beside 密码 and 恢复码** — the owner's
           * instruction (2026-10-13): *"账户里边生成邀请码单独包装成一个入口，放到设置-
           * 账号安全里面."* It is about **the account**, like the other two, and about no
           * ledger and no preference. The hint keeps the distinction he drew visible:
           * a code **注册账号**, it does not put anybody into a ledger.
           */
          {
            label: t("settings.security.referral.label"),
            hint: t("settings.security.referral.hint"),
            to: "/settings/referral-codes",
          },
        ]}
        onNavigate={open}
      />
    </SettingsSubPage>
  );
}
