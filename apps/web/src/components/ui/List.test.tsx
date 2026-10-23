import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { FactRow, ListGroup, ListRow, ProseSection } from "./List.js";
import { RecordGroup, RecordList, RecordRow } from "./RecordList.js";

/**
 * **S16-A 列表积木：只钉"看起来可点 = 真的可点"这一条规则。**
 *
 * 视觉（间距、字号）由截图核对；这里检查的是截图看不出来、却最容易悄悄坏掉的东西：
 * 静态资料被渲染成按钮、操作行多画了一个"去往别处"的箭头、只读资料不在 `dl` 里。
 */
function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter initialEntries={["/"]}>{node}</MemoryRouter>);
}

describe("ListRow", () => {
  it("is a link with a trailing chevron when it goes somewhere", () => {
    const html = render(<ListRow label="个人资料" to="/profile" />);
    expect(html).toMatch(/^<a [^>]*href="\/profile"/);
    expect(html).toContain('data-chevron="right"');
  });

  it("is a button when it performs something on the spot", () => {
    const html = render(<ListRow label="刷新" onClick={() => undefined} />);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('data-chevron="right"');
  });

  it("draws no chevron for an in-place action", () => {
    const html = render(<ListRow label="复制邀请链接" tone="action" onClick={() => undefined} />);
    expect(html).not.toContain("data-chevron");
  });

  it("is plain content — no link, no button, no chevron — when it does nothing", () => {
    const html = render(<ListRow label="当前版本" value="1.15.05" />);
    expect(html).toMatch(/^<div /);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("data-chevron");
  });

  it("lets a custom trailing control replace the chevron", () => {
    const html = render(<ListRow label="自动检查" onClick={() => undefined} trailing={<span>开关</span>} />);
    expect(html).not.toContain("data-chevron");
    expect(html).toContain("开关");
  });

  it("renders a disabled link as a disabled button, so it cannot be followed", () => {
    const html = render(<ListRow label="邀请成员" to="/invite" disabled />);
    expect(html).not.toContain("href=");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
});

describe("FactRow", () => {
  it("is a term/description pair inside a dl, never a control", () => {
    const html = render(
      <ListGroup as="dl" title="账号">
        <FactRow label="用户名" value="zhang" hint="登录时使用" />
      </ListGroup>,
    );
    expect(html).toContain("<dl ");
    expect(html).toMatch(/<dt[^>]*>用户名<\/dt>/);
    expect(html).toContain("登录时使用");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("data-chevron");
  });
});

describe("ListGroup and ProseSection", () => {
  it("keeps the footer next to the group it explains", () => {
    const html = render(
      <ListGroup title="数据" footer="导出只包含当前账本。">
        <ListRow label="导出" to="/export" />
      </ListGroup>,
    );
    // One section: the heading, the frame, then the sentence — not a separate box elsewhere.
    expect(html).toMatch(/^<section[^>]*>.*rounded-card.*导出只包含当前账本。.*<\/section>$/s);
  });

  it("does not put explanatory prose into a card", () => {
    const html = render(<ProseSection title="隐私">不出售数据。</ProseSection>);
    expect(html).not.toContain("rounded-card");
    expect(html).toContain("<h2");
  });
});

describe("RecordRow", () => {
  it("is a list item, and a link only when there is something to open", () => {
    const linked = render(
      <RecordList label="历史">
        <RecordRow primary="张三 修改了 #0001" aside="14:32" to="/transactions/abc" />
      </RecordList>,
    );
    expect(linked).toContain("<ul");
    expect(linked).toMatch(/<li[^>]*><a [^>]*href="\/transactions\/abc"/);

    const plain = render(
      <RecordList label="历史">
        <RecordRow primary="张三 删除了账本" aside="昨天" />
      </RecordList>,
    );
    expect(plain).not.toContain("<a ");
  });

  it("truncates the primary line instead of letting it wrap", () => {
    const html = render(
      <RecordList label="历史">
        <RecordRow primary={"很长的备注".repeat(20)} title="完整原文" />
      </RecordList>,
    );
    expect(html).toMatch(/class="[^"]*truncate[^"]*"[^>]*title="完整原文"/);
  });

  it("gives a day group a heading that stays with its rows", () => {
    const html = render(
      <RecordGroup heading="今天">
        <RecordRow primary="一条" />
      </RecordGroup>,
    );
    expect(html).toContain("今天");
    expect(html).toContain("sticky");
  });
});
