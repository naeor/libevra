import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BottomSheet } from "./BottomSheet.js";

/**
 * ⚠️ **The sheet's whole contract is "a labelled dialog that slides in from the bottom and hands its
 * content a way to close itself".** The slide is pure CSS (`.sheet-in` / `.sheet-out` in index.css), so
 * the static test can only pin the wiring: the dialog roles, the entrance class, and the close function.
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
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="引用一条记录"');
    expect(html).toContain("sheet-in");
    expect(html).toContain("backdrop-in");
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
