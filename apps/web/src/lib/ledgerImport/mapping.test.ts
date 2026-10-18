import { describe, expect, it } from "vitest";

import type { Category, PaymentMethod, Tag } from "@libellum/shared";

import { buildTaxonomyMappingPlan, normalizeObjectName, taxonomyResolutionKey } from "./mapping.js";

function category(
  id: string,
  name: string,
  kind: "expense" | "income",
  options: { readonly isSystem?: boolean; readonly isArchived?: boolean } = {},
): Category {
  return {
    id,
    name,
    kind,
    description: null,
    isSystem: options.isSystem ?? false,
    isArchived: options.isArchived ?? false,
    sortOrder: 0,
  };
}

function payment(id: string, name: string, isArchived = false): PaymentMethod {
  return { id, name, isArchived, sortOrder: 0 };
}

function tag(id: string, name: string, color: string): Tag {
  return { id, name, color };
}

const TARGET = {
  categories: [
    category("t-sys-exp", "暂无分类", "expense", { isSystem: true }),
    category("t-sys-inc", "暂无分类", "income", { isSystem: true }),
    category("t-food", "餐饮", "expense"),
    category("t-shop-arch", "购物", "expense"),
    category("t-salary", "工资", "income"),
  ],
  paymentMethods: [payment("t-wechat", "微信"), payment("t-card-arch", "银行卡")],
  tags: [tag("t-trip", "出差", "#111111"), tag("t-reimb", "报销", "#222222")],
};

const SOURCE = {
  categories: [
    category("s-sys-exp", "暂无分类", "expense", { isSystem: true }),
    category("s-sys-inc", "暂无分类", "income", { isSystem: true }),
    category("s-food", "餐饮", "expense"),
    category("s-shop-arch", "购物", "expense", { isArchived: true }),
    category("s-traffic", "交通", "expense"),
    category("s-salary", "工资", "income"),
  ],
  paymentMethods: [payment("s-wechat", "微信"), payment("s-card-arch", "银行卡", true), payment("s-alipay", "支付宝")],
  tags: [tag("s-trip", "出差", "#111111"), tag("s-reimb", "报销", "#999999"), tag("s-project", "项目", "#333333")],
};

describe("normalizeObjectName", () => {
  it("统一全半角和空白，保留中文语义", () => {
    expect(normalizeObjectName("  餐 饮  ")).toBe("餐 饮");
    expect(normalizeObjectName("ＡＢＣ")).toBe("ABC");
    expect(normalizeObjectName("出差")).toBe("出差");
  });
});

describe("buildTaxonomyMappingPlan", () => {
  it("同名且属性兼容的对象复用目标对象", () => {
    const plan = buildTaxonomyMappingPlan(SOURCE, TARGET);

    expect(plan.categories.find((item) => item.source.id === "s-food")?.targetId).toBe("t-food");
    expect(plan.categories.find((item) => item.source.id === "s-salary")?.targetId).toBe("t-salary");
    expect(plan.paymentMethods.find((item) => item.source.id === "s-wechat")?.targetId).toBe("t-wechat");
    expect(plan.tags.find((item) => item.source.id === "s-trip")?.targetId).toBe("t-trip");
    expect(plan.categories.find((item) => item.source.id === "s-food")?.matchKey).toBe("target:t-food");
  });

  it("D2：用户为同名属性冲突选择新建时，映射改为保留来源属性的新对象", () => {
    const resolutions = new Map([
      [taxonomyResolutionKey("category", "s-shop-arch"), "create" as const],
      [taxonomyResolutionKey("tag", "s-reimb"), "create" as const],
    ]);
    const plan = buildTaxonomyMappingPlan(SOURCE, TARGET, resolutions);
    const shop = plan.categories.find((item) => item.source.id === "s-shop-arch");
    expect(shop?.targetId).toBeNull();
    expect(shop?.matchKey).toBe("new:s-shop-arch");
    expect(shop?.createArchived).toBe(true);
    expect(shop?.createName).toBe("购物（2）");

    const reimbursed = plan.tags.find((item) => item.source.id === "s-reimb");
    expect(reimbursed?.targetId).toBeNull();
    expect(reimbursed?.matchKey).toBe("new:s-reimb");
    expect(reimbursed?.createColor).toBe("#999999");
    // A conflict that the user did not choose stays on the provisional target mapping.
    expect(plan.paymentMethods.find((item) => item.source.id === "s-card-arch")?.targetId).toBe("t-card-arch");
  });  it("系统分类按目标账本的系统分类匹配，不靠名字或 id", () => {
    const plan = buildTaxonomyMappingPlan(SOURCE, TARGET);
    expect(plan.categories.find((item) => item.source.id === "s-sys-exp")?.targetId).toBe("t-sys-exp");
    expect(plan.categories.find((item) => item.source.id === "s-sys-inc")?.targetId).toBe("t-sys-inc");
  });

  it("来源独有对象创建到目标，保留归档状态和标签颜色", () => {
    const plan = buildTaxonomyMappingPlan(SOURCE, TARGET);

    const traffic = plan.categories.find((item) => item.source.id === "s-traffic");
    expect(traffic?.targetId).toBeNull();
    expect(traffic?.createName).toBe("交通");
    expect(traffic?.createArchived).toBe(false);

    const alipay = plan.paymentMethods.find((item) => item.source.id === "s-alipay");
    expect(alipay?.targetId).toBeNull();
    expect(alipay?.createName).toBe("支付宝");

    const project = plan.tags.find((item) => item.source.id === "s-project");
    expect(project?.targetId).toBeNull();
    expect(project?.createName).toBe("项目");
    expect(project?.createColor).toBe("#333333");
  });

  it("同名但归档状态不同的分类/支付方式产生冲突，不静默覆盖目标", () => {
    const plan = buildTaxonomyMappingPlan(SOURCE, TARGET);

    const shop = plan.categories.find((item) => item.source.id === "s-shop-arch");
    expect(shop?.conflict?.reason).toBe("category_archive_mismatch");
    expect(shop?.targetId).toBe("t-shop-arch");
    expect(shop?.createArchived).toBe(true);
    expect(shop?.createName).toBe("购物（2）");

    const card = plan.paymentMethods.find((item) => item.source.id === "s-card-arch");
    expect(card?.conflict?.reason).toBe("payment_method_archive_mismatch");
    expect(card?.targetId).toBe("t-card-arch");
  });

  it("同名但颜色不同的标签产生冲突，并保留来源颜色作为新建候选", () => {
    const plan = buildTaxonomyMappingPlan(SOURCE, TARGET);
    const reimb = plan.tags.find((item) => item.source.id === "s-reimb");
    expect(reimb?.conflict?.reason).toBe("tag_color_mismatch");
    expect(reimb?.createColor).toBe("#999999");
    expect(reimb?.targetId).toBe("t-reimb");
  });

  it("冲突项不冒充无冲突复用：计数分别统计", () => {
    const plan = buildTaxonomyMappingPlan(SOURCE, TARGET);
    expect(plan.counts.categories).toEqual({ reuse: 4, create: 1, conflict: 1 });
    expect(plan.counts.paymentMethods).toEqual({ reuse: 1, create: 1, conflict: 1 });
    expect(plan.counts.tags).toEqual({ reuse: 1, create: 1, conflict: 1 });
    expect(plan.conflicts).toHaveLength(3);
  });

  it("同名的收入/支出分类在不同 kind 下互不冲突", () => {
    const plan = buildTaxonomyMappingPlan(
      {
        categories: [
          category("s-sys-exp", "暂无分类", "expense", { isSystem: true }),
          category("s-other-exp", "其他", "expense"),
          category("s-other-inc", "其他", "income"),
          category("s-sys-inc", "暂无分类", "income", { isSystem: true }),
        ],
        paymentMethods: [],
        tags: [],
      },
      {
        categories: [
          category("t-sys-exp", "暂无分类", "expense", { isSystem: true }),
          category("t-other-exp", "其他", "expense"),
          category("t-sys-inc", "暂无分类", "income", { isSystem: true }),
        ],
        paymentMethods: [],
        tags: [],
      },
    );
    expect(plan.categories.find((item) => item.source.id === "s-other-exp")?.targetId).toBe("t-other-exp");
    expect(plan.categories.find((item) => item.source.id === "s-other-inc")?.targetId).toBeNull();
    expect(plan.categories.find((item) => item.source.id === "s-other-inc")?.createName).toBe("其他");
  });

  it("自定义分类与目标系统分类同名时给出系统属性冲突", () => {
    const plan = buildTaxonomyMappingPlan(
      {
        categories: [
          category("s-sys-exp", "暂无分类", "expense", { isSystem: true }),
          category("s-custom-uncat", "暂无分类", "expense"),
          category("s-sys-inc", "暂无分类", "income", { isSystem: true }),
        ],
        paymentMethods: [],
        tags: [],
      },
      {
        categories: [
          category("t-sys-exp", "暂无分类", "expense", { isSystem: true }),
          category("t-sys-inc", "暂无分类", "income", { isSystem: true }),
        ],
        paymentMethods: [],
        tags: [],
      },
    );
    const conflict = plan.categories.find((item) => item.source.id === "s-custom-uncat")?.conflict;
    expect(conflict?.reason).toBe("category_system_mismatch");
    expect(conflict?.targetId).toBe("t-sys-exp");
  });

  it("新建名称保持目标账本唯一，重复候选追加序号", () => {
    const plan = buildTaxonomyMappingPlan(
      {
        categories: [
          category("s-sys-exp", "暂无分类", "expense", { isSystem: true }),
          category("s-a", "购物", "expense"),
          category("s-b", "购物（2）", "expense"),
          category("s-sys-inc", "暂无分类", "income", { isSystem: true }),
        ],
        paymentMethods: [],
        tags: [],
      },
      {
        categories: [
          category("t-sys-exp", "暂无分类", "expense", { isSystem: true }),
          category("t-sys-inc", "暂无分类", "income", { isSystem: true }),
        ],
        paymentMethods: [],
        tags: [],
      },
    );
    expect(plan.categories.find((item) => item.source.id === "s-a")?.createName).toBe("购物");
    expect(plan.categories.find((item) => item.source.id === "s-b")?.createName).toBe("购物（2）");
  });
});

