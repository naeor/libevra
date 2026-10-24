import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import enCollab from "../i18n/resources/en-US/collab.js";
import zhCollab from "../i18n/resources/zh-CN/collab.js";

/**
 * The wording the owner asked for, pinned.
 *
 * These are not tests of behaviour; they are tests of **register**. The owner
 * asked for the interface to read as objective description — the tone of a
 * system settings screen — rather than as a person talking. A rule like that
 * is invisible in a diff and erodes with the next edit, so the specific
 * sentences are asserted here and the reason is written next to each one.
 */
function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/**
 * **Only the text a user can read.**
 *
 * ⚠️ **Comments are removed, and that is not a technicality.** The code in these files *quotes the
 * owner's own instructions* — including the words of the flow that was removed — so that a reader can
 * see why the code looks the way it does. A rule checked against raw source would forbid the code
 * from explaining its own history, and **the honest fix would then be to delete the explanation**,
 * which is the opposite of what the documentation rules ask for.
 *
 * So this strips comments and returns what is left: the strings, the JSX text, the attributes. **The
 * register rules were always about the interface** — see the file header — and this is what makes the
 * check mean that.
 */
function visibleText(relativePath: string): string {
  return source(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "") // /* … */ and /** … */ blocks
    .replace(/^\s*\/\/.*$/gm, ""); // whole-line // comments
}

describe("analysis screen copy", () => {
  it("describes itself as a computed result", () => {
    // Was "把账目变成看得懂的图。" — warm, but it describes a feeling rather
    // than saying what the screen is.
    // S16：文案搬进 `stats` 模块；页面用键取，句子本身仍逐字钉在中文资源里。
    expect(source("../i18n/resources/zh-CN/stats.ts")).toContain('subtitle: "以下结果由已记录的账目计算得出。"');
    expect(source("../pages/StatsPage.tsx")).toContain('subtitle={t("stats.subtitle")}');
  });

  it("does not explain exchange rates where none are applied", () => {
    // The owner asked for this sentence to go: stating that no conversion
    // happens is noise on a screen that does not convert anything.
    expect(source("../pages/StatsPage.tsx")).not.toContain("不进行汇率换算");
    expect(source("../i18n/resources/zh-CN/stats.ts")).not.toContain("不进行汇率换算");
    expect(source("../pages/AddEntryPage.tsx")).not.toContain("不进行汇率换算");
  });
});

describe("invitation copy", () => {
  /**
   * ⚠️ **`CollaboratorsPage.tsx` no longer exists (1.10.05), and this test is what would have
   * noticed it silently.** The account-level collaborator screen was removed on the owner's
   * instruction; its subject matter — inviting somebody into a ledger — moved to
   * `LedgerInvitePage.tsx`. **What matters is the wording, not which file holds it**, and that is
   * exactly what the old assertion said about the move before this one.
   */
  it("invites rather than describes togetherness", () => {
    const invite = source("../pages/LedgerInvitePage.tsx");

    // The screen says what pressing the button does, and to whom.
    // S16：文字搬进了 `i18n/resources/zh-CN/collab.ts`；页面引用这两个键，资源里仍是原句。
    expect(invite).toContain('t("collab.invite.send")');
    expect(invite).toContain('t("collab.invite.sent")');
    expect(zhCollab.invite.send).toBe("发送邀请");
    expect(zhCollab.invite.sent).toContain("接受之后才真正加入");
  });

  /**
   * S16：邀请页、留言页的界面文字现在住在 `collab` 文案模块里，下面两条规则因此也要查那里——
   * 否则旧流程的说法或口语化措辞可以借着“搬进资源文件”绕过检查。
   */
  it("keeps the moved collaboration text free of the retired flow and of colloquial phrasing", () => {
    const resources = JSON.stringify([zhCollab, enCollab]);
    for (const retired of ["协作者", "去邀请", "/collaborators"]) {
      expect(resources, `collab 文案出现「${retired}」`).not.toContain(retired);
    }

    const inviteText = JSON.stringify(zhCollab.invite);
    for (const colloquial of ["都是 0", "还没有", "没什么", "搞定", "挺好的"]) {
      expect(inviteText, `邀请页文案出现「${colloquial}」`).not.toContain(colloquial);
    }
  });

  /**
   * ⚠️ **⚠️ The old flow's instructions must not survive anywhere.** The owner's requirement is
   * explicit: *"请检查所有因业务逻辑改变而过时的按钮、标题、提示和说明，不允许留下「必须先成为
   * 协作者」之类已经不符合新规则的文案."*
   *
   * This is the assertion that keeps that true. The invite screen used to say *"在「协作者」页面按对方
   * 账号编号找到他"* and its button pointed at `/collaborators` — a screen that no longer exists, so
   * the sentence would have been a dead end.
   *
   * ⚠️ **Checked against `visibleText`, not raw source**, so these files may still explain the flow
   * they replaced — see the note on that helper.
   */
  it("leaves no instruction to become a collaborator first", () => {
    const screens = [
      "../pages/LedgerPage.tsx",
      "../pages/LedgerInvitePage.tsx",
      "../pages/LedgerSubPages.tsx",
      "../pages/MessageBoardPage.tsx",
    ];

    for (const file of screens) {
      const text = visibleText(file);

      for (const retired of ["协作者", "去邀请", "/collaborators"]) {
        expect(text, `${file} shows 「${retired}」 to the user`).not.toContain(retired);
      }
    }
  });
});

describe("account copy", () => {
  it("keeps the recovery-code warning without restoring the retired field explanations", () => {
    // S16：所有者删除账号字段解释，但恢复码的安全提醒必须保留。
    // S16 国际化：文字搬进 `account` 文案模块，页面里留下的是键——两处一起检查。
    const profile = source("../pages/ProfilePage.tsx");
    const accountCopy = source("../i18n/resources/zh-CN/account.ts");

    expect(profile).toContain('t("account.profile.recoveryWarning")');
    expect(accountCopy).toContain('recoveryWarning: "请勿向任何人透露恢复码');
    for (const text of [profile, accountCopy]) {
      expect(text).not.toContain("可安全地分享给他人");
      expect(text).not.toContain("恢复码必须保密");
    }
  });
});

describe("archive copy", () => {
  it("says what archiving does, to the thing being archived", () => {
    // S16：三页的说明搬进 `manage` 模块（中文原文逐字不变），页面按键取。
    const manage = source("../i18n/resources/zh-CN/manage.ts");

    expect(manage).toContain("归档后不再出现在记账选项中");
    expect(manage).not.toContain("归档后不再出现在记账选项里");
    expect(source("../pages/ManagePages.tsx")).toContain('t("manage.categories.hint")');
  });
});

describe("register", () => {
  it("keeps colloquial phrasing out of the screens checked above", () => {
    // The owner's note on an earlier message: "金额都是 0" reads like a person
    // talking. The same words should not creep back in elsewhere.
    const screened = [
      "../pages/StatsPage.tsx",
      "../pages/ManagePages.tsx",
      "../pages/MePage.tsx",
      "../pages/ProfilePage.tsx",
      "../pages/SettingsPage.tsx",
      "../pages/LedgerSpacePage.tsx",
      /**
       * ⚠️ **`LedgerInvitePage` replaces the removed `CollaboratorsPage` in this list (1.10.05)** —
       * it is now the screen the invite wording lives on, so it inherits the same register rule.
       */
      "../pages/LedgerInvitePage.tsx",
    ];

    for (const file of screened) {
      /**
        * ⚠️ **`visibleText`, for the same reason the invitation check uses it** — see the note on that
        * helper. These files legitimately *quote* the phrasing they are avoiding, so that the next
        * reader can see what was rejected and why. Checking raw source would fail on the explanation
        * and the fix would be to delete it, **which is the opposite of what the documentation rules
        * ask for.** What the rule is actually about is what the user reads.
        */
      const text = visibleText(file);

      for (const colloquial of ["都是 0", "还没有", "没什么", "搞定", "挺好的"]) {
        expect(text, `${file} shows 「${colloquial}」 to the user`).not.toContain(colloquial);
      }
    }
  });

  it("keeps the same register in the S16 resource modules for those screens", () => {
    /**
     * S16：分析、分类/标签/支付方式管理、账本空间的界面文字搬进了 `stats` / `manage` / `books` 模块。
     * 规则管的是用户读到的字，所以同样的口语词也不许出现在这些模块的中文资源里（`visibleText` 剥掉注释）。
     */
    for (const file of [
      "../i18n/resources/zh-CN/stats.ts",
      "../i18n/resources/zh-CN/manage.ts",
      "../i18n/resources/zh-CN/books.ts",
    ]) {
      const text = visibleText(file);

      for (const colloquial of ["都是 0", "没什么", "搞定", "挺好的"]) {
        expect(text, `${file} shows 「${colloquial}」 to the user`).not.toContain(colloquial);
      }
    }
  });
});

describe("account entry copy (S14-A)", () => {
  /**
   * ⚠️ **The restricted-registration copy is a product decision, not a placeholder.** The owner
   * ruled out shortage/marketing language ("注册额度已耗尽 / 服务器资源不足 / 名额用完了") and asked
   * for a calm statement of the rule. This test is what keeps a future edit from "improving" it
   * back into scarcity marketing — the file may *quote* the rejected wording in a comment, which is
   * why the check runs on `visibleText`.
   */
  const register = visibleText("../pages/RegisterPage.tsx");
  const login = visibleText("../pages/LoginPage.tsx");
  const guestEntry = visibleText("../components/GuestEntry.tsx");
  const passwordField = visibleText("../components/PasswordField.tsx");

  /** S16 国际化：这几页的文字搬进了 `auth` 文案模块（中文原文一字未改），页面里留下的是键。 */
  const authCopy = visibleText("../i18n/resources/zh-CN/auth.ts");

  it("states the invite rule plainly and without manufactured scarcity", () => {
    expect(register).toContain('t("auth.register.inviteNotice")');
    expect(authCopy).toContain("为了保持稳定的使用体验，目前新账号通过邀请开放。");

    for (const rejected of ["注册额度已耗尽", "服务器资源不足", "名额用完了", "当前没有额度"]) {
      expect(register, `RegisterPage shows 「${rejected}」`).not.toContain(rejected);
      expect(authCopy, `auth copy shows 「${rejected}」`).not.toContain(rejected);
    }
  });

  it("asks only for username, password and its confirmation (plus the invite code when required)", () => {
    expect(register).toContain('t("auth.field.confirmPassword")');
    expect(register).toContain('t("auth.register.passwordMismatch")');
    expect(authCopy).toContain('confirmPassword: "确认密码"');
    expect(authCopy).toContain('passwordMismatch: "两次输入的密码不一致。"');
    // The reveal control is shared by both password inputs; its label lives in one component.
    expect(passwordField).toContain('t("auth.passwordToggle.show")');
    expect(authCopy).toContain('show: "显示密码"');
    // The nickname/email/phone/code fields the owner ruled out must not appear as inputs.
    for (const rejected of ['label="昵称"', 'label="邮箱"', 'label="手机号"', 'label="验证码"']) {
      expect(register, `RegisterPage shows ${rejected}`).not.toContain(rejected);
    }
    // Every input label on the page is one of the allowed fields.
    const labels = [...register.matchAll(/label=\{t\("([^"]+)"\)\}/g)].map((match) => match[1]).sort();
    expect(labels).toEqual(
      ["auth.field.confirmPassword", "auth.field.inviteCode", "auth.field.password", "auth.field.username"],
    );
  });

  it("keeps the guest entry on the account screens and opens the shared app", () => {
    // The entry itself is a shared component; its label lives in one place.
    expect(guestEntry).toContain('t("auth.guestEntry")');
    expect(authCopy).toContain('guestEntry: "以游客身份继续"');
    // S14-C: guest mode is the real app, so the entry goes to `/` and creates/reuses the identity.
    expect(guestEntry).toContain('to="/"');
    expect(guestEntry).toContain("createGuestIdentity");

    // Login no longer hard-codes "invite registration" as the only way to create an account —
    // with S14-A the register page decides that from the server's mode.
    expect(login).not.toContain("使用邀请码注册");
    expect(authCopy).not.toContain("使用邀请码注册");
  });
});

describe("guest mode copy (S14-C)", () => {
  const guestMe = visibleText("../pages/GuestMePage.tsx");
  const badge = visibleText("../components/GuestModeBadge.tsx");
  const bottomNav = visibleText("../components/BottomNav.tsx");

  it("states the identity compactly and does not repeat a registration pitch", () => {
    // S16 国际化：文字在 `account` 文案模块，页面里留下的是键——两处一起检查。
    const accountCopy = visibleText("../i18n/resources/zh-CN/account.ts");
    expect(badge).toContain('t("account.guest.badge")');
    expect(accountCopy).toContain('badge: "游客模式"');
    expect(guestMe).toContain('t("account.guestMe.identity")');
    expect(accountCopy).toContain('identity: "游客身份"');
    for (const text of [guestMe, accountCopy]) {
      expect(text).not.toContain("请先注册");
      expect(text).not.toContain("你正在游客模式");
    }
  });

  it("separates guest data from a formal account and warns about no cloud backup", () => {
    const accountCopy = visibleText("../i18n/resources/zh-CN/account.ts");
    expect(guestMe).toContain('t("account.guestMe.formalNote")');
    expect(accountCopy).toContain("创建或登录正式账号后");
    expect(accountCopy).toContain("游客账本不会自动上传、合并或删除");
    expect(guestMe).toContain('t("account.guestMe.noBackup")');
    expect(accountCopy).toContain("游客数据没有云端备份");
    expect(guestMe).toContain('t("account.guestMe.clearGuest")');
    expect(accountCopy).toContain('clearGuest: "清除游客数据"');
    expect(guestMe).toContain('t("account.guestMe.clearAll")');
    expect(accountCopy).toContain('clearAll: "清除此设备全部 Libevra 本地数据"');
  });

  it("disables server-only recording actions with a reason instead of faking them", () => {
    // The local form stays; voice/photo are server-side and say why they are unavailable.
    // S16：原因句在 `nav` 模块（中文原文不变），底栏按键取。
    expect(bottomNav).toContain('t("nav.entry.needsAccount"');
    expect(visibleText("../i18n/resources/zh-CN/nav.ts")).toContain("需要正式账号");
  });
});
