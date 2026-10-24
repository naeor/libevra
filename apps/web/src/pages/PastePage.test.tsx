import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseTransactionText,
  type CategoryCandidate,
} from "@libellum/shared";

import { applyLocale } from "../i18n/index.js";
import { PastePage, recognisePastedText } from "./PastePage.js";

/**
 * 粘贴页的验收分两层：
 *
 * 1. **纯函数**：一段粘贴文字被拆成几笔、每笔是否保留自己的原文、字段是否与
 *    语音入口共用同一个解析核心。这是页面真正的工作。
 * 2. **静态渲染**：页面确实提供手动粘贴框、用户主动点击的剪贴板按钮，并把
 *    “不自动读取 / 不发外部 AI / 未确认不写入”说清楚。
 *
 * 仓库的 vitest 跑在 Node 环境（没有 DOM），所以交互（点击、剪贴板授权）留给
 * 真实浏览器验收；这里不假装测过它们。
 */

const NOW = new Date(2026, 9, 22, 10, 30, 0);

const LEDGER: readonly CategoryCandidate[] = [
  { id: "c-food", name: "餐饮", kind: "expense", isArchived: false },
  { id: "c-transport", name: "交通", kind: "expense", isArchived: false },
];

function renderPage(): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/paste"]}>
        <PastePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("粘贴识别的纯解析", () => {
  it("用与语音相同的共享核心解析自然语言", () => {
    const candidates = recognisePastedText("今天中午麦当劳花了 28.5 元。", LEDGER, NOW);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.sourceText).toBe("今天中午麦当劳花了 28.5 元。");
    expect(candidates[0]?.parsed).toMatchObject({
      amount: "28.5",
      currency: "CNY",
      kind: "expense",
      occurredLocalDate: "2026-10-22",
      merchant: "麦当劳",
      categoryId: "c-food",
    });
  });

  it("保留每一笔自己的原文，不把整段粘贴文本塞进每笔备注", () => {
    const candidates = recognisePastedText(
      "麦当劳 28.5 元\n\n打车 20 元",
      LEDGER,
      NOW,
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.sourceText).toBe("麦当劳 28.5 元");
    expect(candidates[1]?.sourceText).toBe("打车 20 元");
    expect(candidates[0]?.parsed.amount).toBe("28.5");
    expect(candidates[1]?.parsed.amount).toBe("20");
    expect(candidates[1]?.parsed.categoryId).toBe("c-transport");
  });

  it("空文本不会制造一笔空交易", () => {
    expect(recognisePastedText("   \n  ", LEDGER, NOW)).toEqual([]);
  });

  it("编号列表无法可靠拆分时明确标记，供页面阻止误合并", () => {
    const candidates = recognisePastedText(
      "1. 麦当劳 28.5 元\n2. 打车 20 元",
      LEDGER,
      NOW,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.parsed.multipleTransactions).toBe(true);
  });

  it("同一句话在语音与粘贴入口得到完全相同的字段", () => {
    const samples = [
      "今天中午麦当劳花了 28.5 元。",
      "昨晚支付宝 32 块奶茶。",
      "收到朋友还款 150。",
      "前天三百五。",
      "上周五 Uber Eats 23.62 美元。",
    ] as const;

    for (const text of samples) {
      const pasted = recognisePastedText(text, LEDGER, NOW);
      const spokenPath = parseTransactionText(text, { categories: LEDGER, now: NOW });

      expect(pasted).toHaveLength(1);
      expect(pasted[0]?.parsed).toEqual(spokenPath);
    }
  });
});

describe("粘贴页的入口、隐私说明与手动输入", () => {
  it("标题、说明、多行输入与两个主动按钮都在", () => {
    const html = renderPage();

    expect(html).toContain("粘贴识别");
    expect(html).toContain("粘贴交易文字，自动识别金额、日期和分类。");
    expect(html).toContain('id="paste-text"');
    expect(html).toContain("从剪贴板粘贴");
    expect(html).toContain("识别交易");
    expect(html).toContain("清空");
  });

  it("明确说明不会自动读剪贴板、不发外部 AI、确认前不写入", () => {
    const html = renderPage();

    expect(html).toContain("不会自动读取剪贴板");
    expect(html).toContain("不会把文字发给外部 AI");
    expect(html).toContain("不会在确认前写入账本");
  });
});

describe("粘贴页（英文界面，S16）", () => {
  afterEach(() => {
    applyLocale("zh-CN");
  });

  it("界面是英文，输入框示例保持识别语言（中文）", () => {
    applyLocale("en-US");
    const html = renderPage();

    expect(html).toContain("Paste text");
    expect(html).toContain("Paste from clipboard");
    // 示例是识别语言的原文，刻意不翻译。
    expect(html).toContain("For example: 今天中午麦当劳花了 28.5 元");

    // 去掉页面框架的返回栏（不属于本页）与示例占位文字后，不应再有中文。
    const own = html.replace(/<nav[\s\S]*?<\/nav>/g, "").replace(/placeholder="[^"]*"/g, "");
    expect(own).not.toMatch(/[㐀-鿿]/);
  });
});
