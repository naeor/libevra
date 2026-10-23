import type { Transaction } from "@libellum/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuthProvider } from "../../auth/AuthProvider.js";
import { BatchAddSheet } from "./BatchAddSheet.js";

function transaction(): Transaction {
  return {
    id: "e1",
    kind: "expense",
    amountCents: 1234,
    currency: "CNY",
    categoryId: "c-food",
    categoryName: "吃饭",
    categoryIsSystem: false,
    paymentMethodId: "p-cash",
    paymentMethodName: "现金",
    occurredAt: "2026-10-10T09:12:00+08:00",
    occurredLocalDate: "2026-10-10",
    occurredTz: "Asia/Shanghai",
    note: "午饭",
    tags: [],
    version: 1,
  };
}

function render(open: boolean): string {
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <BatchAddSheet
          open={open}
          source={transaction()}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("BatchAddSheet screen", () => {
  it("renders one prefilled card, the actions and the single save button", () => {
    const html = render(true);

    expect(html).toContain("批量记账");
    expect(html).toContain("第 1 笔");
    expect(html).toContain("再记一笔");
    expect(html).toContain("记账设置");
    expect(html).toContain("保存 1 笔");
    expect(html).toContain("取消");
  });

  it("renders nothing when closed", () => {
    expect(render(false)).toBe("");
  });
});
