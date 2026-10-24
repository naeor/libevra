import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type { NotDuplicateRelation } from "@libellum/shared";

import { applyLocale } from "../i18n/index.js";
import { NotDuplicateRelationsView } from "./NotDuplicateRelationsSection.js";

/**
 * S15-E3 · 「已忽略的重复交易」管理区的结构与安全文案。
 *
 * 纯 Node 环境（无 DOM），所以用 `renderToStaticMarkup` 检查渲染结果：
 * 撤销按钮的禁用条件、viewer/离线说明、已撤销与失效状态、空态。
 * 交互（真正调用撤销）由 API 集成测试覆盖，这里只保证界面不会给出错误的可点性。
 */

const A = "01990000-0000-7000-8000-000000000001";
const B = "01990000-0000-7000-8000-000000000002";

function relation(overrides: Partial<NotDuplicateRelation> = {}): NotDuplicateRelation {
  return {
    id: "01990000-0000-7000-8000-0000000000aa",
    bookId: "01990000-0000-7000-8000-0000000000ff",
    transactionAId: A,
    transactionBId: B,
    relationship: "not_duplicate",
    decisionSource: "manual",
    decidedBy: "01990000-0000-7000-8000-0000000000cc",
    decidedByName: "小明",
    decidedAt: "2026-10-21T03:00:00.000Z",
    revokedAt: null,
    revokedBy: null,
    revokedByName: null,
    revocationReason: null,
    stale: false,
    staleFields: [],
    effective: true,
    transactionA: {
      id: A,
      seq: 12,
      occurredAt: "2026-10-21T02:03:00.000Z",
      occurredLocalDate: "2026-10-21",
      amountCents: 1234,
      currency: "CNY",
      kind: "expense",
      categoryName: "餐饮",
      paymentMethodName: "微信",
      deleted: false,
    },
    transactionB: {
      id: B,
      seq: 13,
      occurredAt: "2026-10-21T02:04:00.000Z",
      occurredLocalDate: "2026-10-21",
      amountCents: 1234,
      currency: "CNY",
      kind: "expense",
      categoryName: "餐饮",
      paymentMethodName: "微信",
      deleted: false,
    },
    ...overrides,
  };
}

function html({
  items = [relation()],
  canWrite = true,
  offline = false,
  showRevoked = false,
  loading = false,
  error = null,
  pendingId = null,
}: {
  readonly items?: readonly NotDuplicateRelation[];
  readonly canWrite?: boolean;
  readonly offline?: boolean;
  readonly showRevoked?: boolean;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly pendingId?: string | null;
} = {}): string {
  return renderToStaticMarkup(
    <NotDuplicateRelationsView
      items={items}
      canWrite={canWrite}
      offline={offline}
      showRevoked={showRevoked}
      loading={loading}
      error={error}
      pendingId={pendingId}
      onToggleRevoked={() => undefined}
      onRevoke={() => undefined}
    />,
  );
}

describe("已忽略的重复交易管理区", () => {
  it("展示两笔交易的编号、日期、金额、方向与确认信息", () => {
    const markup = html();

    expect(markup).toContain("已忽略的重复交易");
    expect(markup).toContain("#000012");
    expect(markup).toContain("#000013");
    expect(markup).toContain("2026-10-21");
    expect(markup).toContain("确认人：小明");
    expect(markup).toContain("生效中：重复提示会忽略这一对");
    expect(markup).toContain("撤销这条判断");
    // 可写 + 在线 → 按钮没有 disabled（class 里的 `disabled:` 变体不算）。
    expect(markup).not.toContain('disabled=""');
  });

  it("viewer 看到只读说明，撤销按钮被禁用", () => {
    const markup = html({ canWrite: false });

    expect(markup).toContain("你是这本账的查看者");
    expect(markup).toContain('disabled=""');
  });

  it("离线时说明不能撤销，按钮被禁用", () => {
    const markup = html({ offline: true });

    expect(markup).toContain("当前离线");
    expect(markup).toContain("不能新建或撤销");
    expect(markup).toContain('disabled=""');
  });

  it("已撤销的行显示撤销人与时间，不再显示撤销按钮", () => {
    const markup = html({
      items: [
        relation({
          revokedAt: "2026-10-21T04:00:00.000Z",
          revokedByName: "小红",
          revocationReason: "user_revoked",
          effective: false,
        }),
      ],
      showRevoked: true,
    });

    expect(markup).toContain("已撤销：小红");
    expect(markup).not.toContain("撤销这条判断");
  });

  it("关键字段变化的行说明失效字段，并说明重新参与提示", () => {
    const markup = html({
      items: [relation({ stale: true, staleFields: ["amountCents", "occurredAt"], effective: false })],
    });

    expect(markup).toContain("判定依据已变化（金额、时间）");
    expect(markup).toContain("重新参与重复提示");
  });

  it("对端交易已不存在时给出说明", () => {
    const markup = html({
      items: [relation({ transactionB: null, effective: false })],
    });

    expect(markup).toContain("交易已不存在");
    expect(markup).toContain("不再参与提示");
  });

  it("空态区分「生效中」与「含已撤销」", () => {
    expect(html({ items: [] })).toContain("还没有确认过「不是同一笔」的交易");
    expect(html({ items: [], showRevoked: true })).toContain("还没有撤销过的「不重复」判断");
  });

  it("读取中与错误分别渲染", () => {
    expect(html({ loading: true, items: [] })).toContain("正在读取…");
    expect(html({ error: "服务器暂时不可用", items: [] })).toContain("服务器暂时不可用");
  });

  it("撤销进行中时按钮文案变化并禁用", () => {
    const markup = html({ pendingId: "01990000-0000-7000-8000-0000000000aa" });
    expect(markup).toContain("撤销中…");
    expect(markup).toContain("disabled");
  });
});

describe("已忽略的重复交易管理区（英文界面，S16）", () => {
  afterEach(() => {
    applyLocale("zh-CN");
  });

  it("界面文字全部是英文；预置分类显示译名，确认人等数据原样显示", () => {
    applyLocale("en-US");

    const english = relation({
      decidedByName: "Alex",
      revokedAt: "2026-10-22T03:00:00.000Z",
      revokedByName: "Sam",
      decisionSource: "review_group",
    });
    const stale = relation({
      id: "01990000-0000-7000-8000-0000000000bb",
      decidedByName: "Alex",
      stale: true,
      staleFields: ["amountCents", "occurredAt"],
    });
    const markup = html({ items: [english, stale], canWrite: false, offline: true });

    expect(markup).toContain("Ignored duplicates");
    expect(markup).toContain("Food &amp; drink");
    expect(markup).toContain("Confirmed by Alex");
    expect(markup).toContain("Whole group");
    expect(markup).toContain("Undone by Sam");
    expect(markup).toContain("The details changed (amount and time)");
    expect(markup).not.toMatch(/[㐀-鿿]/);
  });
});
