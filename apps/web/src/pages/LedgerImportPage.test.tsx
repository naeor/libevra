import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { t } from "../i18n/index.js";

/**
 * 账本导入（`/import-ledger`）的两件局部修复（S15-C 第四轮）。
 *
 * 1. **来源 / 目标选择器改成内嵌下拉列表**（`InlineChoice`，与 `/add` 分类选择器同一形态），
 *    不再用底部面板 `ChoiceSheet`；
 * 2. **返回不再自己 push 设置页**，改走 `useGoBack(backTo, "parent")`，步骤切换用 `replace`，
 *    整页只占一条历史记录——否则 导入 → 设置 → 详情 → 导入 会走成环。
 *
 * 本仓库没有 DOM，因此沿用源码断言（与 `backNavigation.test.ts`、`ChoiceSheet.test.tsx`
 * 同一做法）：选择器结构与交互由 `components/ui/InlineChoice.test.tsx` 覆盖。
 */
const source = readFileSync(
  fileURLToPath(new URL("./LedgerImportPage.tsx", import.meta.url)),
  "utf8",
);
/**
 * S16 起页面文案在 `i18n/resources/*\/ledgerImport.ts`；源码里只剩键名。
 * 下面的断言改为“源码用了这个键 + 这个键的中文原文没变”，意图不变。
 */
const zhMessages = readFileSync(
  fileURLToPath(new URL("../i18n/resources/zh-CN/ledgerImport.ts", import.meta.url)),
  "utf8",
);
const enMessages = readFileSync(
  fileURLToPath(new URL("../i18n/resources/en-US/ledgerImport.ts", import.meta.url)),
  "utf8",
);

describe("账本导入的来源/目标选择", () => {
  it("两个入口改用内嵌下拉列表，不再用底部面板 ChoiceSheet", () => {
    expect(source).not.toContain("<select");
    expect(source).not.toContain("</select>");
    expect(source).not.toContain('from "../components/ui/ChoiceSheet.js"');
    expect(source).not.toContain("<ChoiceSheet");
    expect(source).toContain('from "../components/ui/InlineChoice.js"');
    // 一个来源、一个目标；触发按钮与列表都在组件里，页面不再自己拼 aria-haspopup="dialog"。
    expect((source.match(/<InlineChoice/g) ?? []).length).toBe(2);
    expect(source).toContain('testId="import-source"');
    expect(source).toContain('testId="import-target"');
    expect(source).not.toContain('aria-haspopup="dialog"');
  });

  it("选中项仍写回原来的回调，导入逻辑一个字没动", () => {
    expect(source).toContain("onSelect={onChangeSource}");
    expect(source).toContain("onSelect={onChangeTarget}");
    // 目标里"与来源相同"的那一项保留但不可选——与原 select 的 disabled option 一致。
    expect(source).toContain("disabled: book.id === sourceKey");
    expect(source).toContain('hint: t("ledgerImport.select.sameAsSource")');
    expect(t("ledgerImport.select.sameAsSource")).toBe("就是来源账本，不能选");
  });

  it("占位项与游客来源仍存在，选择结果与原来一一对应", () => {
    expect(source).toContain('label: t("ledgerImport.select.sourcePlaceholder")');
    expect(source).toContain('label: t("ledgerImport.select.targetPlaceholder")');
    expect(source).toContain('label: t("ledgerImport.select.guestOption")');
    expect(source).toContain('t("ledgerImport.select.formalOption", { name: book.name })');
    expect(t("ledgerImport.select.sourcePlaceholder")).toBe("选择来源账本");
    expect(t("ledgerImport.select.targetPlaceholder")).toBe("选择目标账本");
    expect(t("ledgerImport.select.guestOption")).toBe("本机游客账本");
    expect(t("ledgerImport.select.formalOption", { name: "旅行" })).toBe("正式账本 · 旅行");
    // 同一时间只开一个：两处共用一个 picking 状态。
    expect(source).toContain('useState<"source" | "target" | null>(null)');
  });
});

describe("账本导入的返回", () => {
  it("离开走统一的 useGoBack（parent 语义），不再自己 push 设置页", () => {
    expect(source).toContain('useGoBack(backTo, "parent")');
    expect(source).not.toContain("void navigate(backTo)");
    // onBack（选择步的离开）与确认完成后的「完成」都必须消耗掉这一页，而不是再 push 一条。
    expect((source.match(/goBack\(\);/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("步骤切换用 replace：整页只占一条历史记录", () => {
    expect(source).toContain("patchSearch({ step: next, group: undefined }, true);");
    expect(source).toContain('patchSearch({ step: "review", group: "0" }, true)');
    expect(source).toContain('step: "confirm",');
    // 步骤地址（step=preview / step=confirm）不允许再以 push 的方式写进历史。
    expect(source).not.toMatch(/patchSearch\(\{[^}]*step: "confirm"[^}]*\}\);/);
  });

  it("返回目标：有目标账本就回它的设置，否则回账本空间（深链兜底）", () => {
    expect(source).toContain('const backTo = target === null ? "/start" : `/books/${target.id}/settings`;');
  });

  it("退出保护仍在：提交中不允许离开", () => {
    expect(source).toContain('if (submitState === "submitting") return;');
  });

  it("两处下拉改为内嵌 InlineChoice；展开箭头统一由 InlineChoice 内的 ChevronIcon 承担", () => {
    // 页面本身不再画箭头：来源/目标两处都交给 InlineChoice（与 /add 分类选择器同一形态）。
    expect(source).not.toContain("⌄");
    expect(source).not.toContain("⌃");
    expect((source.match(/<InlineChoice/g) ?? []).length).toBe(2);

    // ⚠️ 箭头仍然只有一套：InlineChoice 内部改用 Icons.ChevronIcon（同一 path 旋转 180°），
    // 与 /add 第四轮的统一箭头一致；不许退回字符画。
    const inlineChoice = readFileSync(
      fileURLToPath(new URL("../components/ui/InlineChoice.tsx", import.meta.url)),
      "utf8",
    );
    expect(inlineChoice).toContain('import { ChevronIcon } from "../Icons.js";');
    expect(inlineChoice).toContain("<ChevronIcon up={open} />");
    expect(inlineChoice).not.toContain("⌄");
    expect(inlineChoice).not.toContain("⌃");
  });

  it("高风险文案不再声称只会新增，也不把内部 A/B 代号给用户看", () => {
    for (const text of [source, zhMessages, enMessages]) {
      expect(text).not.toContain("本轮只新增，不会修改或删除");
      expect(text).not.toContain("请核对每一笔 A 的去留");
      expect(text).not.toContain('"保留 A"');
      expect(text).not.toContain('"保留 B"');
      expect(text).not.toContain(">来源 B<");
      expect(text).not.toContain(">目标 A<");
      expect(text).not.toContain('"来源 B"');
      expect(text).not.toContain('"目标 A"');
    }
    // 英文里也不出现内部代号（“ledger A / B”）。
    expect(enMessages).not.toMatch(/\b(?:ledger|source|target) [AB]\b/i);
    expect(t("ledgerImport.preview.targetExisting", { count: 2 })).toContain("会在核对步骤逐笔列出并再次确认");
    // 快捷建议按动作 id 取文案（不再在源码里写中文）；动作 id 与原来一一对应。
    expect(source).toContain('(["keep_a", "keep_b", "keep_both", "keep_neither"] as const)');
    expect(source).toContain("t(`ledgerImport.review.preset.${action}.label`)");
    expect(t("ledgerImport.review.preset.keep_a.label")).toBe("保留目标账本");
    expect(t("ledgerImport.review.preset.keep_b.label")).toBe("保留来源账本");
  });
});
