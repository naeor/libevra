import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { zhCN } from "../i18n/resources/index.js";

/**
 * S15-E3 · 拍照记账的确认入口只有一个，而且必须是**显式**的那个。
 *
 * 纯 Node 环境没有 DOM，页面本身需要一个会话与真实上传才能渲染，所以这里读源码断言
 * 两条硬规则：
 *  1. 对话框提供「确认不是同一笔」这个独立选项；
 *  2. **「仍然保存」不记录任何关系**——保留两笔相似账目是合法操作，
 *     不能把它翻译成"用户说这不是同一笔"。
 */

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./ScanPage.tsx", import.meta.url)),
  "utf8",
);

describe("拍照记账的不重复确认入口", () => {
  it("重复对话框提供显式的「确认不是同一笔」选项", () => {
    // S16：选项文案在 `duplicates.reminder.*`，源码里只引用键；中文原文不变。
    expect(PAGE_SOURCE).toContain('id: "confirmNotDuplicate"');
    expect(PAGE_SOURCE).toContain('translate("duplicates.reminder.confirmNotDuplicate")');
    expect(PAGE_SOURCE).toContain('translate("duplicates.reminder.confirmNotDuplicateHint")');
    expect(zhCN.duplicates.reminder.confirmNotDuplicate).toBe("确认不是同一笔");
    expect(zhCN.duplicates.reminder.confirmNotDuplicateHint).toContain("以后不再提示");
  });

  it("「仍然保存」分支不传关系参数（不自动推断）", () => {
    const saveBranch = PAGE_SOURCE.slice(
      PAGE_SOURCE.indexOf('if (choice === "save")'),
      PAGE_SOURCE.indexOf('if (choice === "confirmNotDuplicate")'),
    );

    expect(saveBranch).toContain("write(pending.draft, pending.amountCents)");
    expect(saveBranch).not.toContain("pending.existing.map");
  });

  it("只有确认分支会把对话框里的交易 id 交给写入函数", () => {
    const confirmBranch = PAGE_SOURCE.slice(
      PAGE_SOURCE.indexOf('if (choice === "confirmNotDuplicate")'),
      PAGE_SOURCE.indexOf('if (choice === "replace")'),
    );

    expect(confirmBranch).toContain("pending.existing.map((existing) => existing.id)");
  });

  it("关系记录失败不会假装账目没保存", () => {
    expect(PAGE_SOURCE).toContain('t("capture.scan.notDuplicateFailed", { reason: errorMessage(caught) })');
    expect(zhCN.capture.scan.notDuplicateFailed).toContain("账目已保存，但「不是同一笔」没有记住");
  });
});
