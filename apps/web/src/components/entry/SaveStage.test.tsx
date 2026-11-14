import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Transaction } from "@libellum/shared";

import { t } from "../../i18n/index.js";
import { EntrySaved } from "../EntrySaved.js";
import { SAVE_STAGE_TIMING } from "./SaveStage.js";

/**
 * 1.19.77 保存成功转场的契约（动画本身在运行中的应用里逐帧核对：很快成功 / 慢 / 失败 / 对勾后立即操作 / 烟花中离开）。
 * 这里锁住：成功屏的“到场”状态、文案、最快路径的时长预算、页面里请求与动画的先后关系、开发开关只在开发构建里存在。
 */
const entry = { id: "t-1", kind: "expense", amountCents: 1250, currency: "CNY", categoryId: null, paymentMethodId: null } as unknown as Transaction;
const render = (intro?: "pending" | "success" | "done"): string =>
  renderToStaticMarkup(<EntrySaved entry={entry} intro={intro} categoryName="" paymentName={null} remaining={0} onHome={() => undefined} onAgain={() => undefined} />);
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

describe("成功屏的到场状态", () => {
  it("不传 intro 时就是原来的成功屏（没有 data-saved-intro）", () => {
    const html = render();
    expect(html).not.toContain("data-saved-intro");
    expect(html).toContain(`>${t("entry.saved.title")}<`);
    expect(html).toContain('class="lv-saved-mark"');
  });

  it("pending：标题是“保存中…”，标记是可测量的标记位", () => {
    const html = render("pending");
    expect(html).toContain('data-saved-intro="pending"');
    expect(html).toContain(`>${t("common.action.saving")}<`);
  });

  it("success / done：标题换成“已记账”（与原成功屏用词一致）", () => {
    for (const intro of ["success", "done"] as const) {
      const html = render(intro);
      expect(html).toContain(`data-saved-intro="${intro}"`);
      expect(html).toContain(`>${t("entry.saved.title")}<`);
    }
  });
});

describe("保存转场的时序与页面接线", () => {
  it("最快路径（飞行 + 两段对勾）在 500ms 预算以内", () => {
    expect(SAVE_STAGE_TIMING.travel + SAVE_STAGE_TIMING.short + SAVE_STAGE_TIMING.long).toBeLessThanOrEqual(480);
  });

  it("记一笔：通过校验后才开始转场，重复询问与失败都收回，成功只改状态；不靠定时器推进流程", () => {
    const page = read("../../pages/AddEntryPage.tsx");
    const save = page.slice(page.indexOf("async function save()"), page.indexOf("async function write("));
    // 校验（只读、金额格式、正数）都在开始转场之前
    expect(save.indexOf("beginStage(input)")).toBeGreaterThan(save.indexOf("amountCents <= 0"));
    expect(save).toMatch(/revertStage\(\);\s*\n\s*setPendingDuplicate\(/);
    const write = page.slice(page.indexOf("async function write("), page.indexOf("useEffect(() => {\n    if (saved === null && focusAfterReset.current)"));
    expect(write.match(/revertStage\(\);/g)?.length).toBeGreaterThanOrEqual(3);
    expect(write).toMatch(/setSaved\(entry\);\s*\n[^\n]*\n\s*setStage\(\(current\) => current === null \? null : \{ \.\.\.current, entry, status: "success" \}\)/);
    const stage = read("./SaveStage.tsx");
    expect(stage).not.toMatch(/setTimeout\(/);
  });

  it("模拟慢保存 / 失败的开关只在开发构建里存在", () => {
    const sim = read("../../lib/devSaveSimulation.ts");
    expect(sim).toMatch(/if \(!import\.meta\.env\.DEV \|\| typeof window === "undefined"\) return;/);
  });
});
