import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BillImportCandidate } from "@libellum/shared";

import {
  BillCommitBar,
  BillDoneView,
  BillDuplicateSection,
  BillFileSummary,
  BillFilterRow,
  BillParsingCard,
  BillPickCard,
  BillRowCard,
  BillSummaryPanel,
  billItemsById,
} from "./BillImportViews.js";
import { billDuplicateGroups, type BillFilterCounts, type BillReportView } from "../../lib/billImportUi.js";

/**
 * 展示层用 `renderToStaticMarkup`（仓库里没有 DOM 环境），断言的是“用户能读到的字”
 * 与关键可访问性属性；交互行为由 `pages/ImportPage.test.tsx` 的源码断言与真机检查覆盖。
 */

const NOOP = (): void => undefined;

function candidate(overrides: Partial<BillImportCandidate> = {}): BillImportCandidate {
  return {
    id: "01990000-0000-7000-8000-000000000001",
    selected: true,
    amount: "20.00",
    currency: "CNY",
    kind: "expense",
    date: "2026-10-09",
    time: "12:34:00",
    timezone: "Asia/Shanghai",
    categoryId: null,
    paymentMethodId: null,
    note: "",
    tags: [],
    line: 2,
    timePrecision: "second",
    merchant: "老王便利店",
    sourceRef: "TX-1",
    sourceStatus: "支付成功",
    warnings: [],
    duplicateIds: [],
    identityDuplicate: false,
    ...overrides,
  };
}

const COUNTS: BillFilterCounts = {
  all: 5,
  review: 1,
  duplicate: 1,
  selected: 3,
  excluded: 2,
  total: 5,
  identity: 1,
};

function doneView(overrides: Partial<BillReportView> = {}): BillReportView {
  return {
    status: "success",
    read: 8,
    selected: 6,
    imported: 6,
    skipped: 2,
    failed: 0,
    failures: [],
    skippedLines: [3, 7],
    ...overrides,
  };
}

describe("BillPickCard", () => {
  it("空状态：说明支持哪些来源、上限，并给出判重说明入口", () => {
    const markup = renderToStaticMarkup(
      <BillPickCard
        busy={false}
        disabled={false}
        dragging={false}
        onPick={NOOP}
        onDragOver={NOOP}
        onDragLeave={NOOP}
        onDrop={NOOP}
        template={{ busy: false, onDownload: NOOP }}
      />,
    );

    expect(markup).toContain("选择账单文件");
    expect(markup).toContain("微信 XLSX · 支付宝 CSV · 银行 PDF · Libevra CSV");
    expect(markup).toContain("单个文件最大 10 MB；电脑上也可以把文件拖进来");
    expect(markup).toContain("识别和判重是怎么做的");
    expect(markup).toContain("格式按文件内容识别，不看文件名");
    expect(markup).toContain("之前导入过的同一份来源会标成「来源已存在」并跳过");
    expect(markup).toContain("下载 Libevra CSV 模板");
  });

  it("模板入口可为空；识别中按钮禁用并换文案", () => {
    const markup = renderToStaticMarkup(
      <BillPickCard
        busy
        disabled={false}
        dragging={false}
        onPick={NOOP}
        onDragOver={NOOP}
        onDragLeave={NOOP}
        onDrop={NOOP}
        template={null}
      />,
    );

    expect(markup).toContain("正在识别…");
    expect(markup).not.toContain("下载 Libevra CSV 模板");
    expect(markup).toMatch(/disabled=""[^>]*>[\s\S]*正在识别…/);
  });

  it("拖拽经过时高亮，但拖拽不是唯一入口", () => {
    const markup = renderToStaticMarkup(
      <BillPickCard
        busy={false}
        disabled={false}
        dragging
        onPick={NOOP}
        onDragOver={NOOP}
        onDragLeave={NOOP}
        onDrop={NOOP}
        template={null}
      />,
    );

    expect(markup).toContain("border-brand bg-brand-soft");
    expect(markup).toContain("选择账单文件");
  });
});

describe("BillFileSummary / BillParsingCard", () => {
  it("已选文件显示大小、格式、识别出的来源，并提供更换/清除", () => {
    const markup = renderToStaticMarkup(
      <BillFileSummary
        fileName="微信支付账单(20261001-20261031).xlsx"
        fileSize={12800}
        formatLabel="XLSX"
        sourceLabel="微信支付账单"
        busy={false}
        onChange={NOOP}
        onClear={NOOP}
      />,
    );

    expect(markup).toContain('aria-label="已选文件"');
    expect(markup).toContain("微信支付账单(20261001-20261031).xlsx");
    expect(markup).toContain("13 KB · XLSX · 识别为 微信支付账单");
    expect(markup).toContain("更换");
    expect(markup).toContain("清除");
    // 长文件名靠 truncate 收住，不能把卡片撑出 320 宽度。
    expect(markup).toContain("truncate");
  });

  it("解析中说明可能很慢，并回显文件名", () => {
    const markup = renderToStaticMarkup(
      <BillParsingCard fileName="boa-2026-09.pdf" fileSize={2048} />,
    );

    expect(markup).toContain("正在识别账单…");
    expect(markup).toContain("boa-2026-09.pdf · 2.0 KB");
    expect(markup).toContain("不要关闭页面");
  });
});

describe("BillSummaryPanel / BillFilterRow", () => {
  it("顶部汇总给出读到/待核对/疑似重复/可导入，以及已勾选数量", () => {
    const markup = renderToStaticMarkup(
      <BillSummaryPanel counts={COUNTS} selectedCount={3} readCount={5} identitySkipped={1} />,
    );

    expect(markup).toContain('aria-label="账单概览汇总"');
    expect(markup).toContain("本次读到");
    expect(markup).toContain("待核对");
    expect(markup).toContain("疑似重复");
    expect(markup).toContain("可导入");
    expect(markup).toContain("来源已存在");
    expect(markup).toContain("已勾选 3 笔");
    expect(markup).toContain("数字是怎么算的");
  });

  it("没有身份重复时不占用一行", () => {
    const markup = renderToStaticMarkup(
      <BillSummaryPanel counts={COUNTS} selectedCount={3} readCount={5} identitySkipped={0} />,
    );

    expect(markup).not.toContain(">来源已存在<");
  });

  it("筛选胶囊带数量与 aria-pressed", () => {
    const markup = renderToStaticMarkup(
      <BillFilterRow filter="duplicate" counts={COUNTS} onSelect={NOOP} />,
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="按状态筛选"');
    expect(markup).toContain("全部 5");
    expect(markup).toContain("待核对 1");
    expect(markup).toContain("疑似重复 1");
    expect(markup).toContain("已选 3");
    expect(markup).toContain("已跳过 2");
    expect(markup).toMatch(/aria-pressed="true"[^>]*>疑似重复 1/);
  });
});

describe("BillRowCard", () => {
  it("干净的一笔：显示状态、金额、商户、分类、来源单号，默认收起", () => {
    const markup = renderToStaticMarkup(
      <BillRowCard
        item={candidate()}
        status="ready"
        notes={[]}
        moneyText="¥20.00"
        categoryName={null}
        paymentName={null}
        expanded={false}
        busy={false}
        categories={[]}
        paymentMethods={[]}
        onToggle={NOOP}
        onExpand={NOOP}
        onPatch={NOOP}
      />,
    );

    expect(markup).toContain("可导入");
    expect(markup).toContain("支出");
    expect(markup).toContain("¥20.00");
    expect(markup).toContain("老王便利店");
    expect(markup).toContain("分类：未分类 · 支付方式：未填写");
    expect(markup).toContain("第 2 行");
    expect(markup).toContain("来源单号：");
    expect(markup).toContain("TX-1");
    expect(markup).toContain("查看详情");
    // 没有问题的记录不展开编辑区，也不需要弹窗。
    expect(markup).not.toContain('aria-label="金额"');
    expect(markup).not.toContain("⚠");
  });

  it("有警告时逐条列出，颜色用 warn 令牌", () => {
    const markup = renderToStaticMarkup(
      <BillRowCard
        item={candidate({ warnings: ["金额与账单合计不一致"] })}
        status="review"
        notes={["金额与账单合计不一致", "金额必须大于零且不能超过可保存范围。"]}
        moneyText="¥20.00"
        categoryName="餐饮"
        paymentName="微信零钱"
        expanded={false}
        busy={false}
        categories={[]}
        paymentMethods={[]}
        onToggle={NOOP}
        onExpand={NOOP}
        onPatch={NOOP}
      />,
    );

    expect(markup).toContain("待核对");
    expect(markup).toContain("⚠ 金额与账单合计不一致");
    expect(markup).toContain("text-warn-dark");
    expect(markup).toContain("分类：餐饮 · 支付方式：微信零钱");
  });

  it("身份重复：勾选框禁用且默认不勾选，状态单独说明", () => {
    const markup = renderToStaticMarkup(
      <BillRowCard
        item={candidate({ identityDuplicate: true, selected: true, sourceRef: "TX-OLD" })}
        status="identity"
        notes={["来源身份已存在：这一笔之前导入过，默认不写入，避免重复记账。"]}
        moneyText="¥20.00"
        categoryName={null}
        paymentName={null}
        expanded={false}
        busy={false}
        categories={[]}
        paymentMethods={[]}
        onToggle={NOOP}
        onExpand={NOOP}
        onPatch={NOOP}
      />,
    );

    expect(markup).toContain("来源已存在");
    expect(markup).toMatch(/disabled=""[^>]*aria-label="导入 第 2 行：¥20\.00"/);
    expect(markup).not.toMatch(/checked=""[^>]*aria-label="导入 第 2 行：¥20\.00"/);
    expect(markup).toContain("这一笔之前导入过");
  });

  it("日期只有日精度时明确说“时间信息不足”，不编造时分", () => {
    const markup = renderToStaticMarkup(
      <BillRowCard
        item={candidate({ time: null, timePrecision: "day" })}
        status="ready"
        notes={[]}
        moneyText="$12.34"
        categoryName={null}
        paymentName={null}
        expanded={false}
        busy={false}
        categories={[]}
        paymentMethods={[]}
        onToggle={NOOP}
        onExpand={NOOP}
        onPatch={NOOP}
      />,
    );

    expect(markup).toContain("2026-10-09 · 时间信息不足");
  });

  it("展开后是就地编辑，不弹窗；字段与提示文案完整", () => {
    const markup = renderToStaticMarkup(
      <BillRowCard
        item={candidate({ note: "午饭", tags: ["工作", "报销"] })}
        status="review"
        notes={["请确认收入或支出方向。"]}
        moneyText="¥20.00"
        categoryName="餐饮"
        paymentName={null}
        expanded
        busy={false}
        categories={[{ id: "01990000-0000-7000-8000-00000000c001", name: "餐饮" }]}
        paymentMethods={[{ id: "01990000-0000-7000-8000-00000000p001", name: "微信零钱" }]}
        onToggle={NOOP}
        onExpand={NOOP}
        onPatch={NOOP}
      />,
    );

    expect(markup).toContain("收起详情");
    expect(markup).toContain('aria-label="金额"');
    expect(markup).toContain('aria-label="币种"');
    expect(markup).toContain('aria-label="方向"');
    expect(markup).toContain('aria-label="日期"');
    expect(markup).toContain('aria-label="时间"');
    expect(markup).toContain('aria-label="时区"');
    expect(markup).toContain('aria-label="分类"');
    expect(markup).toContain('aria-label="支付方式"');
    expect(markup).toContain('aria-label="备注"');
    expect(markup).toContain('aria-label="标签"');
    expect(markup).toContain("按账单上的当地时间填写；时区在下面单独确认。");
    expect(markup).toContain("IANA 名称，例如 Asia/Shanghai、America/New_York");
    expect(markup).toContain("工作 报销");
    // 裸 select 必须带 rounded-field（uiConsistency 守卫的另一半）。
    expect(markup).toContain("rounded-field border border-line");
  });
});

describe("BillDuplicateSection", () => {
  it("没有重复时整节不渲染", () => {
    const markup = renderToStaticMarkup(
      <BillDuplicateSection
        groups={[]}
        history={[]}
        itemsById={new Map()}
        moneyText={() => "¥20.00"}
        busy={false}
        onToggle={NOOP}
      />,
    );

    expect(markup).toBe("");
  });

  it("文件内分组可以逐笔保留/跳过，并说明不会自动删除合并", () => {
    const first = candidate({
      id: "01990000-0000-7000-8000-000000000011",
      line: 3,
      duplicateIds: ["01990000-0000-7000-8000-000000000012"],
    });
    const second = candidate({
      id: "01990000-0000-7000-8000-000000000012",
      line: 4,
      duplicateIds: ["01990000-0000-7000-8000-000000000011"],
    });
    const groups = billDuplicateGroups([first, second]);

    const markup = renderToStaticMarkup(
      <BillDuplicateSection
        groups={groups}
        history={[]}
        itemsById={billItemsById({ candidates: [first, second] })}
        moneyText={() => "¥20.00"}
        busy={false}
        onToggle={NOOP}
      />,
    );

    expect(markup).toContain('aria-label="疑似重复"');
    expect(markup).toContain("疑似重复，需要你判断");
    expect(markup).toContain("同一份文件里的第 1 组（2 笔）");
    expect(markup).toContain("系统不会替你删掉或合并任何一笔");
    expect(markup).toContain('aria-label="保留 第 3 行"');
    expect(markup).toContain('aria-label="保留 第 4 行"');
  });

  it("与历史账目相似时只显示已有编号，不改动已有账目", () => {
    const item = candidate({ id: "01990000-0000-7000-8000-000000000021", duplicateIds: ["tx-old-1", "tx-old-2"] });

    const markup = renderToStaticMarkup(
      <BillDuplicateSection
        groups={[]}
        history={[{ candidateId: item.id, ids: ["tx-old-1", "tx-old-2"] }]}
        itemsById={billItemsById({ candidates: [item] })}
        moneyText={() => "¥20.00"}
        busy={false}
        onToggle={NOOP}
      />,
    );

    expect(markup).toContain("和账本里已有账目相似");
    expect(markup).toContain("已有账目不会被改动");
    expect(markup).toContain("已有账目编号");
    expect(markup).toContain("tx-old-1、tx-old-2");
  });
});

describe("BillCommitBar", () => {
  it("显示可导入数量与统一确认，并说明确认前不写入", () => {
    const markup = renderToStaticMarkup(
      <BillCommitBar
        importableCount={3}
        selectedCount={4}
        blockers={[]}
        needsAcknowledgement={false}
        acknowledged={false}
        busy={false}
        dirty={false}
        rechecking={false}
        onAcknowledge={NOOP}
        onConfirm={NOOP}
        onCancel={NOOP}
        onRecheck={NOOP}
      />,
    );

    expect(markup).toContain("可导入 ");
    expect(markup).toContain(">3</strong> 笔");
    expect(markup).toContain("（已勾选 4）");
    expect(markup).toContain("确认导入 3 笔");
    expect(markup).toContain("确认前不会写入账本。");
    expect(markup).toContain("取消这次导入");
    expect(markup).toContain("pb-[env(safe-area-inset-bottom,0px)]");
    // 干净的核对态没有“重新检查”入口，少一个按钮少一分噪音。
    expect(markup).not.toContain("重新检查重复");
  });

  it("有阻塞原因时禁用确认，并给出第一条原因", () => {
    const markup = renderToStaticMarkup(
      <BillCommitBar
        importableCount={0}
        selectedCount={0}
        blockers={["还没有选中要导入的记录：展开每一笔，勾选要写入的记录。", "还有别的"]}
        needsAcknowledgement={false}
        acknowledged={false}
        busy={false}
        dirty={false}
        rechecking={false}
        onAcknowledge={NOOP}
        onConfirm={NOOP}
        onCancel={NOOP}
        onRecheck={NOOP}
      />,
    );

    expect(markup).toContain("还没有选中要导入的记录");
    expect(markup).toContain("还有 1 条原因");
    expect(markup).toMatch(/disabled=""[^>]*>确认导入 0 笔/);
    expect(markup).toContain("text-warn-dark");
  });

  it("有对账差异/警告时必须先勾选已知晓；编辑未重检时出现重新检查", () => {
    const markup = renderToStaticMarkup(
      <BillCommitBar
        importableCount={2}
        selectedCount={2}
        blockers={["请先勾选「我已了解上面的提示」。"]}
        needsAcknowledgement
        acknowledged={false}
        busy={false}
        dirty
        rechecking={false}
        onAcknowledge={NOOP}
        onConfirm={NOOP}
        onCancel={NOOP}
        onRecheck={NOOP}
      />,
    );

    expect(markup).toContain("我已了解上面的提示（对账差异/文件提醒）");
    expect(markup).toContain("记录或选择有变化，请先重新检查重复。");
    expect(markup).toContain("重新检查重复");
    expect(markup).toMatch(/disabled=""[^>]*>确认导入 2 笔/);
  });

  it("提交中按钮禁用并提示正在导入", () => {
    const markup = renderToStaticMarkup(
      <BillCommitBar
        importableCount={2}
        selectedCount={2}
        blockers={[]}
        needsAcknowledgement={false}
        acknowledged
        busy
        dirty={false}
        rechecking={false}
        onAcknowledge={NOOP}
        onConfirm={NOOP}
        onCancel={NOOP}
        onRecheck={NOOP}
      />,
    );

    expect(markup).toContain("正在导入…");
  });

  it("字段或选择变更后，即使没有其他问题也不能沿用旧重复结论提交", () => {
    const markup = renderToStaticMarkup(
      <BillCommitBar importableCount={2} selectedCount={2} blockers={[]}
        needsAcknowledgement={false} acknowledged busy={false} dirty rechecking={false}
        onAcknowledge={NOOP} onConfirm={NOOP} onCancel={NOOP} onRecheck={NOOP} />,
    );
    expect(markup).toMatch(/disabled=""[^>]*>确认导入 2 笔/);
    expect(markup).toContain("记录或选择有变化，请先重新检查重复。");
  });
});

describe("BillDoneView", () => {
  const NOOP_ASYNC = (): void => undefined;

  it("全部成功：四个数字 + 导入编号，不给重试入口", () => {
    const markup = renderToStaticMarkup(
      <BillDoneView
        view={doneView()}
        fileRef="In-abc"
        exportedFileRef={null}
        targetLabel="日常账本（L-1）"
        doneLabel="回到明细"
        busy={false}
        onDone={NOOP_ASYNC}
        onAgain={NOOP_ASYNC}
        onRetry={NOOP_ASYNC}
      />,
    );

    expect(markup).toContain("导入完成");
    expect(markup).toContain("本次读到");
    expect(markup).toContain("8 笔");
    expect(markup).toContain("选中导入");
    expect(markup).toContain("6 笔");
    expect(markup).toContain("成功写入");
    expect(markup).toContain("跳过（已存在）");
    expect(markup).toContain("2 笔");
    expect(markup).toContain("导入编号");
    expect(markup).toContain("In-abc");
    expect(markup).toContain("写入「日常账本（L-1）」");
    expect(markup).toContain("回到明细");
    expect(markup).toContain("再导入一个文件");
    expect(markup).not.toContain("重试失败的记录");
    // 完成页只留两个出口，不放“返回”。
    expect(markup).not.toContain("← 返回");
  });

  it("部分成功：失败定位到 PDF 页/行并允许重试", () => {
    const markup = renderToStaticMarkup(
      <BillDoneView
        view={doneView({
          status: "partial",
          imported: 4,
          selected: 6,
          failed: 2,
          failures: [
            { line: 12, page: 3, where: "第 3 页 · 第 12 行", message: "金额：金额必须大于零且不能超过可保存范围。" },
            { line: 40, page: null, where: "第 40 行", message: "交易日期不存在。" },
          ],
        })}
        fileRef="In-abc"
        exportedFileRef="Out-xyz"
        targetLabel={null}
        doneLabel="回到明细"
        busy={false}
        onDone={NOOP_ASYNC}
        onAgain={NOOP_ASYNC}
        onRetry={NOOP_ASYNC}
      />,
    );

    expect(markup).toContain("部分导入成功");
    expect(markup).toContain("失败的仍留在这份预览里，可以重试");
    expect(markup).toContain("失败原因（可以按位置回文件里改）");
    expect(markup).toContain("第 3 页 · 第 12 行");
    expect(markup).toContain("金额必须大于零且不能超过可保存范围。");
    expect(markup).toContain("第 40 行");
    expect(markup).toContain("重试失败的记录");
    expect(markup).toContain("Out-xyz");
    expect(markup).toContain("跳过的行：第 3 行、第 7 行");
  });

  it("全部失败：说清没有写入，且不显示失败明细以外的编造数据", () => {
    const markup = renderToStaticMarkup(
      <BillDoneView
        view={doneView({ status: "failed", imported: 0, selected: 3, failed: 3, failures: [
          { line: 2, page: null, where: "第 2 行", message: "请确认收入或支出方向。" },
        ] })}
        fileRef={null}
        exportedFileRef={null}
        targetLabel={null}
        doneLabel="回到明细"
        busy={false}
        onDone={NOOP_ASYNC}
        onAgain={NOOP_ASYNC}
        onRetry={NOOP_ASYNC}
      />,
    );

    expect(markup).toContain("没有导入成功");
    expect(markup).toContain("这次没有记录写入账本");
    expect(markup).toContain("text-danger");
    expect(markup).not.toContain("导入编号");
  });
});
