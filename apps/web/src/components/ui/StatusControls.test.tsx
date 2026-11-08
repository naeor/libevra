import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge, FilterChip, StatusMessage } from "./StatusControls.js";
import { TextField } from "../TextField.js";

describe("标签与状态的语义边界", () => {
  it("Badge 是静态信息，筛选是真实受控按钮", () => {
    const badge = renderToStaticMarkup(<Badge tone="warning">待处理</Badge>);
    expect(badge).not.toContain("<button"); expect(badge).not.toContain('role="status"');
    const chip = renderToStaticMarkup(<FilterChip selected disabled onSelectedChange={() => undefined}>条件</FilterChip>);
    expect(chip).toContain('type="button"'); expect(chip).toContain('aria-pressed="true"'); expect(chip).toContain('disabled=""');
  });
  it("错误是 alert，加载不隐藏可读状态文字", () => {
    expect(renderToStaticMarkup(<StatusMessage tone="error">失败</StatusMessage>)).toContain('role="alert"');
    const loading = renderToStaticMarkup(<StatusMessage loading>处理中</StatusMessage>);
    expect(loading).toContain('role="status"'); expect(loading).toContain("处理中"); expect(loading).toContain('aria-hidden="true"');
    expect(loading).not.toContain('aria-busy="true"'); // live region 不能因 busy 而压住加载说明
  });
  it("新增字段错误同时关联提示与外部说明，恢复后不遗留错误", () => {
    const html = renderToStaticMarkup(<TextField label="名称" hint="提示" error="必填" aria-describedby="external" />);
    expect(html).toContain('aria-invalid="true"'); expect(html).toMatch(/aria-describedby="external [^"]+-hint [^"]+-error"/); expect(html).toContain('role="alert"');
    const valid = renderToStaticMarkup(<TextField label="名称" hint="提示" />);
    expect(valid).not.toContain('aria-invalid'); expect(valid).not.toContain('role="alert"');
  });
});
