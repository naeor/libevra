import type { QuoteTargetsResponse, MessageReferenceView } from "@libellum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyLocale } from "../i18n/index.js";

/**
 * ⚠️ **`useQuoteTargets` is mocked at the module boundary**: the picker is presentational — it renders
 * whatever the query returned and hands one row back — so the test supplies rows instead of a server.
 */
vi.mock("../lib/queries.js", () => ({
  useQuoteTargets: vi.fn(),
}));

const { useQuoteTargets } = await import("../lib/queries.js");
const { QuotePickerSheet, QuoteReferenceCard, pickableEvents } = await import("./MessageQuote.js");

const transactionSnapshot = {
  kind: "transaction" as const,
  id: "01930000-0000-7000-8000-000000000001",
  seq: 128,
  code: "#000128",
  title: "买菜",
  categoryName: "餐饮",
  note: "买菜",
  amountCents: "8600",
  currency: "CNY",
  transactionKind: "expense" as const,
  occurredAt: "2026-10-20T04:00:00.000Z",
};

const eventSnapshot = {
  kind: "event" as const,
  id: "01930000-0000-7000-8000-0000000000e1",
  eventKind: "updated" as const,
  occurredAt: "2026-10-21T04:00:00.000Z",
  actorName: "林夏",
  transactionId: transactionSnapshot.id,
  transactionSeq: 128,
  summary: "林夏 修改了 #000128 买菜",
  changes: [
    { label: "金额", from: "¥86", to: "¥68" },
    { label: "备注", from: "买菜", to: "超市" },
  ],
};

function reference(overrides: Partial<MessageReferenceView> = {}): MessageReferenceView {
  return {
    kind: "transaction",
    id: transactionSnapshot.id,
    available: true,
    snapshot: transactionSnapshot,
    ...overrides,
  };
}

afterEach(() => {
  applyLocale("zh-CN");
});

function wrap(node: React.ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter initialEntries={["/ledger/messages"]}>{node}</MemoryRouter>);
}

describe("引用卡片", () => {
  it("shows what the entry was, not just that it was quoted", () => {
    const html = wrap(<QuoteReferenceCard reference={reference()} />);

    expect(html).toContain("买菜");
    expect(html).toContain("86.00");
    expect(html).toContain("餐饮");
    expect(html).toContain("#000128");
  });

  it("shows the edit as it happened, including the change", () => {
    const html = wrap(
      <QuoteReferenceCard reference={{ kind: "event", id: eventSnapshot.id, available: true, snapshot: eventSnapshot }} />,
    );

    /**
     * ⚠️ **The server's sentence is shown verbatim in Chinese** — the same rule the history list uses
     * — and the change rows are the point of quoting an edit: *"引用一次修改时，卡片必须永远说当时
     * 那一句「¥86 → ¥68」."*
     */
    expect(html).toContain("林夏 修改了 #000128 买菜");
    expect(html).toContain("86");
    expect(html).toContain("68");
  });

  it("says so when the target is gone instead of failing the message list", () => {
    const html = wrap(<QuoteReferenceCard reference={reference({ available: false })} />);

    expect(html).toContain("已删除或不可访问");
    expect(html).toContain("买菜");
    expect(html).not.toContain('href="/transactions/');
  });

  it("does not link an unavailable quote", () => {
    const available = wrap(<QuoteReferenceCard reference={reference()} href={`/transactions/${transactionSnapshot.id}`} />);
    const gone = wrap(<QuoteReferenceCard reference={reference({ available: false })} />);

    expect(available).toContain(`href="/transactions/${transactionSnapshot.id}"`);
    expect(gone).not.toContain('href="/transactions/');
  });

  it("can be removed before sending", () => {
    expect(wrap(<QuoteReferenceCard reference={reference()} onRemove={() => undefined} />)).toContain("取消引用");
    expect(wrap(<QuoteReferenceCard reference={reference()} />)).not.toContain("取消引用");
  });
});

describe("选择引用的面板", () => {
  /** ⚠️ 修改栏不该重复列出「添加了」——账目本身就在旁边一栏。 */
  function targets(): QuoteTargetsResponse {
    return {
      transactions: [{ kind: "transaction", id: transactionSnapshot.id, snapshot: transactionSnapshot }],
      events: [
        {
          kind: "event",
          id: eventSnapshot.id,
          snapshot: eventSnapshot,
        },
        {
          kind: "event",
          id: "01930000-0000-7000-8000-0000000000e2",
          snapshot: {
            ...eventSnapshot,
            id: "01930000-0000-7000-8000-0000000000e2",
            eventKind: "created" as const,
            summary: "林夏 添加了 #000129 午餐",
          },
        },
      ],
    };
  }

  function renderPicker(): string {
    vi.mocked(useQuoteTargets).mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: targets(),
    } as unknown as ReturnType<typeof useQuoteTargets>);

    return wrap(<QuotePickerSheet onPick={() => undefined} onClose={() => undefined} />);
  }

  it("offers entries and edits, and hides the redundant “added” event", () => {
    const html = renderPicker();

    expect(html).toContain("引用一条记录");
    expect(html).toContain("账目");
    expect(html).toContain("修改历史");
    expect(html).toContain("买菜");

    /**
     * ⚠️ **「添加了」 is filtered out of the edit column** — the entry itself is in the other tab, and
     * listing the creation as an “edit” would make people pick the wrong row.
     */
    const rows = pickableEvents(targets().events);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.snapshot.summary).toContain("修改了 #000128 买菜");
  });

  it("says quoting is optional", () => {
    expect(renderPicker()).toContain("引用是可选的");
  });
});
