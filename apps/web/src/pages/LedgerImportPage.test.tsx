import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 账本导入（`/import-ledger`）第一步的"来源 / 目标"选择器。
 *
 * ⚠️ **这是本轮"导入页面"里被修的同类问题。** `/import`（CSV 导入）没有任何原生下拉；
 * 原生灰菜单出现在 `/import-ledger` 的「来源账本 B / 目标账本 A」两处，与 `/add` 的币种
 * 是同一个视觉问题。这里没有 DOM，因此断言源码层面的三件事：不再有 `<select>`、
 * 两个入口仍分别接回原来的回调、弹层用的是与 `/add` 相同的 `ChoiceSheet`。
 */
const source = readFileSync(
  fileURLToPath(new URL("./LedgerImportPage.tsx", import.meta.url)),
  "utf8",
);

describe("账本导入的来源/目标选择", () => {
  it("不再使用原生 select，两个入口改用项目内的选择弹层", () => {
    expect(source).not.toContain("<select");
    expect(source).not.toContain("</select>");
    expect(source).toContain('from "../components/ui/ChoiceSheet.js"');
    expect(source).toContain('data-testid="import-source"');
    expect(source).toContain('data-testid="import-target"');
    // 两个入口是按钮 + aria-haspopup，和 /add 币种一致。
    expect(source.match(/aria-haspopup="dialog"/g)?.length).toBe(2);
  });

  it("选中项仍写回原来的回调，导入逻辑一个字没动", () => {
    expect(source).toContain("onSelect={onChangeSource}");
    expect(source).toContain("onSelect={onChangeTarget}");
    // 目标里"与来源相同"的那一项保留但不可选——与原 select 的 disabled option 一致。
    expect(source).toContain("disabled: book.id === sourceKey");
    expect(source).toContain("就是来源账本，不能选");
  });

  it("占位项与游客来源仍存在，选择结果与原来一一对应", () => {
    expect(source).toContain('label: "选择来源账本"');
    expect(source).toContain('label: "选择目标账本"');
    expect(source).toContain('label: "本机游客账本"');
    expect(source).toContain("`正式账本 · ${book.name}`");
  });
});
