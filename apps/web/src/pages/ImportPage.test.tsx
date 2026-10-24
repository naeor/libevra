import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { t } from "../i18n/index.js";

/**
 * 页面级断言：仓库的 vitest 跑在 Node 环境（没有 DOM / Testing Library），页面又带着一堆
 * query hooks，无法直接渲染。这里像 `ImportPage.entry.test.tsx` 一样读源码，检查“接线”
 * 是否真的存在——防止改到一半漏掉 `recheckBill` 或把身份重复又变成可勾选。
 *
 * 展示层文案由 `components/import/BillImportViews.test.tsx` 用 `renderToStaticMarkup` 覆盖，
 * 纯逻辑由 `lib/billImportUi.test.ts` 覆盖，三者不重复。
 *
 * S16：页面文案搬进了 `dataio.*`。源码里断言的是“用了哪个键”，再用 `t()` 断言这个键的中文原文
 * 没变——意图与原来一致：文案存在、没被悄悄改掉。
 */

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const PAGE = source("./ImportPage.tsx");

describe("ImportPage 的骨架与文案", () => {
  it("标题是「导入账单」，并说明四种来源都可以", () => {
    expect(PAGE).toContain('title={t("dataio.import.title")}');
    expect(t("dataio.import.title")).toBe("导入账单");
    expect(PAGE).toContain('subtitle={t("dataio.import.subtitle")}');
    expect(t("dataio.import.subtitle")).toBe("微信、支付宝、银行结单都可以。先识别，核对后再写入。");
  });

  it("文件输入是 sr-only（不是 hidden），带 aria-label，并在 onChange 里清空 value", () => {
    expect(PAGE).toContain("accept={BILL_IMPORT_ACCEPT}");
    expect(PAGE).toContain('aria-label={t("dataio.pick.choose")}');
    expect(t("dataio.pick.choose")).toBe("选择账单文件");
    expect(PAGE).toContain('className="sr-only"');
    expect(PAGE).toContain('event.target.value = ""');
    expect(PAGE).not.toContain('className="hidden"');
    // sr-only 而不是 display:none：iOS Safari 会忽略对未渲染 input 的程序化 click。
    expect(PAGE).toContain("fileInput.current?.click()");
  });

  it("选择前先做本地格式/大小校验，不按文件名猜格式", () => {
    expect(PAGE).toContain("billFileProblem(picked)");
    expect(PAGE).toContain("previewBill(");
    expect(PAGE).toContain("localTimeZone()");
    expect(PAGE).toContain("useDuplicateDetectionSettings()");
  });

  it("未分类的失败给出重试建议，不误报文件格式或要求运行开发命令", () => {
    // 只有服务端真的回了可读错误（ApiRequestError）才是“文件没识别”；
    // 请求根本没到达服务时（例如 API 没启动），文件本身不一定有问题。
    expect(PAGE).toContain("caught instanceof ApiRequestError");
    expect(PAGE).toContain('t("dataio.import.recognizeUnknown")');
    expect(t("dataio.import.recognizeUnknown")).toContain("暂时无法识别文件，请重试");
    expect(PAGE).not.toContain("项目根目录运行 pnpm dev");
    expect(t("dataio.import.recognizeUnknown")).not.toContain("pnpm dev");
  });

  it("核对页用服务端判重结果分组，编辑后可以重新检查", () => {
    expect(PAGE).toContain("billDuplicateGroups(items)");
    expect(PAGE).toContain("billHistoryDuplicates(items)");
    expect(PAGE).toContain("recheckBill(");
    // 「重新检查重复」按钮在底部确认条里（BillCommitBar），页面负责把 onRecheck 接到 runRecheck。
    expect(PAGE).toContain("onRecheck={() => void runRecheck()}");
    expect(t("dataio.commit.recheck")).toBe("重新检查重复");
  });

  it("提交走 commitBill + 确认对话框，成功后刷新明细并进入结果页", () => {
    expect(PAGE).toContain("commitBill(");
    expect(PAGE).toContain("await invalidateMoney()");
    expect(PAGE).toContain('setStep({ name: "done"');
    expect(PAGE).toContain("billReportView(");
    expect(PAGE).toContain('cancelLabel={t("dataio.confirm.cancel")}');
    expect(t("dataio.confirm.cancel")).toBe("再看看");
    // 导入是新增记录，确认按钮不能是 danger（红色 = 删除）。
    expect(PAGE).toContain('tone="default"');
    expect(PAGE).toContain('description={t("dataio.confirm.description")}');
    expect(t("dataio.confirm.description")).toContain("会把这批选中的记录写入账本");
  });

  it("选择变化也会进入重核，身份重复仍以服务端结论为准", () => {
    expect(PAGE).toContain("patchCandidate(item.id, { selected })");
    expect(PAGE).toContain("billRowStatus(item, problemOf(item))");
  });

  it("固定底栏之外留了等高空白，最后一笔不会被盖住", () => {
    expect(PAGE).toContain('className="h-44"');
    expect(PAGE).toContain("<BillCommitBar");
  });

  it("目标账本横幅在选文件之前就显示，带名称（编号）", () => {
    expect(PAGE).toContain('t("dataio.import.target", { target: target.label })');
    expect(t("dataio.import.target", { target: "家庭账本（00000001）" })).toBe("导入到「家庭账本（00000001）」");
    expect(PAGE).toContain('t("dataio.import.targetHint")');
    expect(t("dataio.import.targetHint")).toContain("请先确认这是你要写入的账本");
    expect(PAGE).toContain('t("dataio.common.bookLabel", { name, number: bookNumber })');
    expect(t("dataio.common.bookLabel", { name: "家庭账本", number: "00000001" })).toBe("家庭账本（00000001）");
  });

  it("入口语义不变：from=nav 隐藏「← 返回导出」，账本设置模式回退到设置页", () => {
    expect(PAGE).toContain('searchParams.get("from") === "nav"');
    expect(PAGE).toContain('fromMenu ? "/" : "/export"');
    expect(PAGE).toContain("hideExportLink={fromMenu}");
    expect(PAGE).toContain('exportTo="/export"');
    expect(PAGE).toContain('t("dataio.import.backToExport")');
    expect(t("dataio.import.backToExport")).toBe("← 返回导出");
    expect(PAGE).toContain("backTo={`/books/${bookId}/settings`}");
    expect(PAGE).toContain('doneLabel={t("dataio.import.doneToSettings")}');
    expect(t("dataio.import.doneToSettings")).toBe("回到账本设置");
  });

  it("不再直接写旧 /import 端点，也不使用 alert/confirm 这类原生弹窗", () => {
    expect(PAGE).not.toContain("useImportEntries");
    expect(PAGE).not.toContain('"/import"');
    expect(PAGE).not.toMatch(/\balert\(/);
    expect(PAGE).not.toMatch(/\bwindow\.confirm\(/);
  });

  it("遵守字号守卫：不写任意字号，金额用 text-section-title", () => {
    expect(PAGE).not.toMatch(/text-\[\d/);
    expect(PAGE).toContain("type BillImportFilter");
  });
});

describe("入口与路由仍然指向 ImportPage", () => {
  it("App.tsx 的 /import 没被改道", () => {
    const app = source("../App.tsx");
    expect(app).toContain('<Route path="/import" element={<RequireAuth><ImportPage /></RequireAuth>} />');
  });

  it("中央 + 菜单第 4 项仍是 /import?from=nav", () => {
    const nav = source("../components/BottomNav.tsx");
    expect(nav).toContain('to: "/import?from=nav"');
  });
});
