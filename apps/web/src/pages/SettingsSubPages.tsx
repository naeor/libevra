import { useNavigate } from "react-router";

import { DuplicateDetectionSettingsCard } from "../components/DuplicateDetectionSettings.js";
import { InnerPage } from "../components/Layouts.js";
import {
  CurrencyQuickPick,
  SettingsRowList,
  useDefaultCurrency,
} from "../components/SettingsCard.js";

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
 * ⚠️ **The default currency control is the same component the home uses**, driven
 * by the same `useDefaultCurrency` hook. **There is no second currency state on
 * this page**: pressing a pill here patches the account exactly as it does on the
 * home, and the selected pill updates from the PATCH's own answer.
 */
export function PreferencesPage(): React.JSX.Element {
  const navigate = useNavigate();
  const currency = useDefaultCurrency();

  return (
    <SettingsSubPage title="记账偏好">
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-helper text-muted">默认币种</h2>

        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
          <CurrencyQuickPick
            value={currency}
            hint="该币种将排在所有币种列表的最前。汇率折算功能开放后，其它币种默认折算为该币种。"
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
        <h2 className="px-1 text-helper text-muted">重复交易检测</h2>

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
        <h2 className="px-1 text-helper text-muted">录入与界面</h2>
        <SettingsRowList
          rows={[
            { label: "大键盘输入金额", hint: "使用应用内的大号数字键盘" },
            { label: "沿用上一笔", hint: "新建记录时自动填入上次使用的分类等信息" },
            { label: "登录后直接开始记账", hint: "跳过明细页，直接进入记账界面" },
            { label: "币种显示顺序", hint: "默认币种固定排在最前" },
            { label: "主界面按钮位置", hint: "左手 / 右手" },
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
 * ⚠️ **Three items, all pending, and nothing else.** 语言 / 主题色 / 汇率折算 are the
 * whole of this category. Export and import are **not** listed here: the audit
 * caught them labelled 「后续开放」 while the pages already existed, and the S13-E
 * decision moved them to 账本设置 → 数据管理, where the data they act on lives.
 */
export function AppearancePage(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <SettingsSubPage title="显示与数据">
      <SettingsRowList
        rows={[
          { label: "语言", hint: "中文 / English" },
          { label: "主题色", hint: "跟随系统或手动选择" },
          { label: "汇率折算", hint: "将各币种折算为一种货币后统计" },
        ]}
        onNavigate={(to) => void navigate(to)}
      />
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

  const open = (to: string): void => {
    void navigate(to, { state: { from: "/settings/security" } });
  };

  return (
    <SettingsSubPage title="账号安全">
      <SettingsRowList
        rows={[
          {
            label: "更改密码",
            hint: "修改后，其它设备上的登录状态将失效",
            to: "/settings/password",
          },
          {
            label: "生成新的恢复码",
            hint: "生成后，原有恢复码将立即失效",
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
            label: "邀请码",
            hint: "让别人注册 Libevra 账号，与你的账本无关",
            to: "/settings/referral-codes",
          },
        ]}
        onNavigate={open}
      />
    </SettingsSubPage>
  );
}
