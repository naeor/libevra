import { useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { InnerPage } from "../components/Layouts.js";
import { ListGroup } from "../components/ui/List.js";
import {
  CurrencyQuickPick,
  SettingsCategoryCard,
  useDefaultCurrency,
  type DefaultCurrency,
} from "../components/SettingsCard.js";
import { useAdminEntry } from "../lib/admin.js";
import { currencyName } from "../lib/format.js";

/**
 * **The settings home — five categories, and one quick action.**
 *
 * ⚠️ **This screen used to be the whole of 设置**, with every group expanded: the
 * default-currency card, ten 「后续开放」 rows, the account rows, the administrator
 * group and 关于. The owner's instruction for this round was a **设置首页 + 分类子页面**
 * structure, so each category now has one card that opens its own short screen and
 * **the home itself fits on a phone without scrolling to the bottom**.
 *
 * ⚠️ **The default currency is the one exception: it stays on the home as a quick
 * control**, because it is the setting people actually come here to change. It sits
 * **below the 记账偏好 card, not inside it** — see `SettingsCategoryCard` for why that
 * is a structural requirement rather than a layout preference.
 *
 * ⚠️ **What is deliberately absent.** 显示与数据 and 账号安全 have **no quick buttons
 * here**: a fake language toggle or a "theme" switch would be a control that does
 * nothing, which is the class of defect the account/settings audit was written
 * about. Their cards are honest — they open a page that says what is available.
 *
 * ⚠️ **导出数据 / 导入历史账 are not on this screen and must not come back (S13-E).**
 * They operate on **one ledger**, not on this account, so their entries live in
 * 账本设置 → 数据管理; `/export` and `/import` themselves are unchanged.
 *
 * The component is presentational on purpose: the flags and callbacks are passed
 * in, so the card order, the descriptions and the administrator gate can be
 * asserted in a test without a DOM or a network.
 */
export function SettingsHome({
  isAdmin,
  currency,
  onOpen,
}: {
  readonly isAdmin: boolean;
  readonly currency: DefaultCurrency;
  readonly onOpen: (to: string) => void;
}): React.JSX.Element {
  return (
    /**
     * ⚠️ **S16-A：三组，而不是六张等大的卡片。** 「记账」一组（偏好 + 默认币种快选），
     * 「账号与系统」一组，「关于」单独一组。分组让"哪些是一类"一眼可见；行与行之间是贯通的分隔线，
     * 整组只有一个外框（`ListGroup`）。卡片的顺序、描述、管理员入口的显示条件都没有变。
     */
    <div className="flex flex-col gap-5">
      {/**
       * ⚠️ **记账偏好 的卡片，以及卡片下方的默认币种快捷控件。**
       *
       * 卡片本身**整卡可点**，打开 `/settings/preferences`；币种控件是它**下方**的
       * 独立元素，不在卡片的 `<button>` 里——所以点币种永远不会触发卡片导航，也不需要
       * `stopPropagation`。这是本轮明确要求的结构（"不要嵌套 button，用并列元素"）。
       */}
      <ListGroup>
        <SettingsCategoryCard
          title="记账偏好"
          description="默认币种、重复提醒与录入习惯"
          to="/settings/preferences"
          onOpen={onOpen}
        />

        <div className="flex flex-col gap-2.5 px-5 py-3.5">
          {/**
           * The current value is written out as well as highlighted: the pills are
           * the control, this line is the answer to "what is it now?".
           */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-card-title text-ink">默认币种</span>
            <span className="text-body text-muted">{currencyName(currency.current)}</span>
          </div>
          <CurrencyQuickPick value={currency} />
        </div>
      </ListGroup>

      <ListGroup>
        <SettingsCategoryCard
          title="显示与数据"
          description="语言、主题与汇率显示"
          to="/settings/appearance"
          onOpen={onOpen}
        />

        <SettingsCategoryCard
          title="账号安全"
          description="密码、恢复码与邀请码"
          to="/settings/security"
          onOpen={onOpen}
        />

        <SettingsCategoryCard
          title="账号与数据"
          description="导出、删除数据与注销账号"
          to="/settings/account-data"
          onOpen={onOpen}
        />

        {/**
         * ⚠️ **「系统管理」只在 `useAdminEntry` 说是的时候渲染（S13-C）。**
         *
         * 所有者 2026-10-17：*"如果不是管理员用户的话，直接隐藏管理入口就行，或者说压根不渲染."*
         * 所以这里没有"灰着的入口"、没有"无权访问"的占位——**普通账号看到的就是没有这一张卡片**。
         * 卡片打开管理台 `/admin`，五个子页（邀请码、管理员、账号、操作记录）由管理台自己列出，
         * 每一页打开时仍会向服务器确认一次。
         *
         * ⚠️ **放在「账号安全」之后、「关于」之前**：它是关于**整个系统**的一张，既不属于
         * 记账偏好，也不属于某一个人的账号安全，而「关于」按惯例留在最后。
         */}
        {isAdmin ? (
          <SettingsCategoryCard
            title="系统管理"
            description="平台概览、账号、邀请码与操作记录"
            to="/admin"
            onOpen={onOpen}
          />
        ) : null}
      </ListGroup>

      <ListGroup>
        <SettingsCategoryCard
          title="关于 Libevra"
          description="版本信息、开源协议与隐私说明"
          to="/about"
          onOpen={onOpen}
        />
      </ListGroup>
    </div>
  );
}

/**
 * `/settings` — the settings home.
 *
 * ⚠️ **The administrator gate is `useAdminEntry`, the cheap two-layer check** (account
 * number in the first batch, then one `/admin/self` answer). It decides whether a
 * card is **rendered**; it is not a permission. The server still authorises every
 * administrator call, and nothing in this file may ever be trusted by it.
 *
 * ⚠️ **The default currency comes from `useDefaultCurrency`**, the same hook the
 * 记账偏好 sub-page uses. There is no second currency state on this screen: the
 * selected pill and the written value both come from the PATCH's own answer, and
 * `reload()` keeps `AuthProvider` — and therefore 明细／分析／导出 — in step.
 */
export function SettingsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const currency = useDefaultCurrency();

  const isAdmin = useAdminEntry(user?.accountNumber);

  return (
    <InnerPage title="设置" backTo="/me">
      <SettingsHome
        isAdmin={isAdmin}
        currency={currency}
        onOpen={(to) => {
          void navigate(to);
        }}
      />
    </InnerPage>
  );
}
