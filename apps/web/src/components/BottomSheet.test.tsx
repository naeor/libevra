import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BottomSheet, SheetHeader } from "./BottomSheet.js";

/**
 * ⚠️ **The sheet's whole contract is "a labelled dialog that slides in from the bottom and hands its
 * content a way to close itself".** The slide is pure CSS (`.sheet-in` / `.sheet-out` in index.css), so
 * the static test can only pin the wiring: the dialog roles, the entrance class, and the close function.
 *
 * 1.19.58 起它也是弹出面板模板的外壳：标题行（标题 + 右上角 44px ×）、只在可下拉时出现的拖动条、
 * 档位与宽屏形态标记、固定底部操作区、门禁变体。手势、焦点与询问需要 DOM，这里只钉住结构；
 * 判断本身在 `lib/closeGuard.test.ts`、`lib/sheetDrag.test.ts` 里测。
 */
describe("从下往上展开的面板", () => {
  it("renders a labelled modal dialog with the entrance animation", () => {
    const html = renderToStaticMarkup(
      <BottomSheet label="引用一条记录" onClose={() => undefined}>
        {(close) => (
          <button type="button" onClick={close}>
            关闭
          </button>
        )}
      </BottomSheet>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-overlay-root="sheet"');
    expect(html).toContain('data-overlay-surface="sheet"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="引用一条记录"');
    expect(html).toContain("sheet-in");
    // 遮罩由模板的遮罩档（根节点伪元素）绘制，不再是根节点上的 bg-ink/45 + backdrop-in。
    expect(html).toContain('data-overlay-scrim="sheet"');
    expect(html).not.toContain("bg-ink/45");
    expect(html).toContain("关闭");
  });

  it("accepts plain children as well as a close-receiving function", () => {
    const html = renderToStaticMarkup(
      <BottomSheet label="测试面板" onClose={() => undefined}>
        <p>面板内容</p>
      </BottomSheet>,
    );

    expect(html).toContain("面板内容");
    expect(html).toContain('aria-label="测试面板"');
  });
});

describe("弹出面板模板（1.19.58）", () => {
  it("给了标题就画模板标题行：标题 + 右上角统一的 ×", () => {
    const html = renderToStaticMarkup(
      <BottomSheet label="选择币种" title="选择币种" description="只列账本里用过的币种" onClose={() => undefined}>
        <p>列表</p>
      </BottomSheet>,
    );

    expect(html).toContain("data-sheet-header");
    expect(html).toContain("选择币种");
    expect(html).toContain("只列账本里用过的币种");
    // 统一的关闭按钮：44px（size-11）圆形点击区，名称“关闭{标题}”。
    expect(html).toContain("data-sheet-close");
    expect(html).toContain("size-11");
    expect(html).toContain('aria-label="关闭选择币种"');
    // 标题、说明与 × 都在内容滚动区之前，滚动列表时不会被带走。
    expect(html.indexOf("data-sheet-header")).toBeLessThan(html.indexOf("data-sheet-body"));
  });

  it("拖动条只出现在可以下拉关闭的面板上，起手区是拖动条与标题行", () => {
    const sheet = renderToStaticMarkup(
      <BottomSheet label="面板" title="面板" onClose={() => undefined}>
        <p>内容</p>
      </BottomSheet>,
    );
    expect(sheet).toContain("data-sheet-handle");
    // 拖动条与标题行都是起手区；内容滚动区不是。
    expect(sheet.split('data-overlay-drag="true"').length - 1).toBe(2);
    const body = sheet.slice(sheet.indexOf("data-sheet-body"));
    expect(body).not.toContain("data-overlay-drag");
  });

  it("门禁变体：没有 ×、没有拖动条，层级最高", () => {
    const html = renderToStaticMarkup(
      <BottomSheet label="同意书" title="同意书" dismissible={false} layer="gate" onClose={() => undefined}>
        <p>正文</p>
      </BottomSheet>,
    );

    expect(html).not.toContain("data-sheet-close");
    expect(html).not.toContain("data-sheet-handle");
    expect(html).not.toContain("data-overlay-drag");
    expect(html).toContain('data-sheet-gate="true"');
    expect(html).toContain("z-[80]");
  });

  it("档位与宽屏形态写成标记，大档用对话框档遮罩", () => {
    const half = renderToStaticMarkup(<BottomSheet label="a" onClose={() => undefined}>x</BottomSheet>);
    expect(half).toContain('data-sheet-detent="half"');
    expect(half).toContain('data-sheet-wide="center"');
    expect(half).toContain('data-overlay-scrim="sheet"');

    const large = renderToStaticMarkup(
      <BottomSheet label="b" detent="large" wide="bottom" onClose={() => undefined}>x</BottomSheet>,
    );
    expect(large).toContain('data-sheet-detent="large"');
    expect(large).toContain('data-sheet-wide="bottom"');
    expect(large).toContain('data-overlay-scrim="dialog"');
    // 一直贴底的形态不带 `.lv-sheet`：宽工作区里不会被改成居中对话框。
    expect(large).not.toMatch(/class="[^"]*\blv-sheet(-backdrop)?[\s"]/);
    expect(half).toMatch(/class="[^"]*\blv-sheet[\s"]/);
  });

  it("固定底部操作区在内容滚动区之后、不在滚动区里", () => {
    const html = renderToStaticMarkup(
      <BottomSheet label="批量修改" title="批量修改" footer={<button type="button">应用</button>} onClose={() => undefined}>
        <p>很长的表单</p>
      </BottomSheet>,
    );
    const body = html.indexOf("data-sheet-body");
    const footer = html.indexOf("data-sheet-footer");
    expect(footer).toBeGreaterThan(body);
    expect(html.slice(body, footer)).not.toContain("应用");
    expect(html.slice(footer)).toContain("应用");
  });

  it("内容里也可以用模板标题行（标题随面板内部状态变化时）", () => {
    const html = renderToStaticMarkup(
      <BottomSheet label="预设库" onClose={() => undefined}>
        <SheetHeader title="预设库" actions={<button type="button">导出</button>} />
      </BottomSheet>,
    );
    expect(html).toContain("data-sheet-header");
    expect(html).toContain("data-sheet-close");
    expect(html).toContain("导出");
  });

  it("面板不再各写一份 Tab 圈与下拉手势：都由外壳负责", () => {
    const source = readFileSync(fileURLToPath(new URL("./BottomSheet.tsx", import.meta.url)), "utf8");
    expect(source).toContain("useDialogFocus");
    expect(source).toContain("useSheetDrag");
    expect(source).toContain("decideClose");
    expect(source).not.toContain('key === "Tab"');
  });
});
