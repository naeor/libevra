import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 1.19.78 / 1.19.81：手动记账是独立工作区；顶栏返回与系统返回一致（所有者 2026-11-15：
 * “它要拦我们的返回，那当然也要拦系统的返回”）。系统返回的保护记录需要浏览器，这里锁住接线。
 */
const page = readFileSync(new URL("./AddEntryPage.tsx", import.meta.url), "utf8");
const guard = readFileSync(new URL("../lib/closeGuard.ts", import.meta.url), "utf8");

describe("记账工作区的返回", () => {
  it("顶栏返回与系统返回用同一个“未保存”判断、同一个询问", () => {
    expect(page).toContain("const dirty = amountText.trim() !== \"\" || note.trim() !== \"\" || attachments.files.length > 0;");
    expect(page).toContain("usePageBackGuard(workspaceChrome && pane.nav === \"bottom\" && dirty && saved === null, () => { setLeaveAsk(true); })");
    expect(page).toContain("onBack={() => { if (dirty) setLeaveAsk(true); else leaveWorkspace(); }}");
  });

  it("确认放弃后经保护记录离开（不会被自己再拦一次，也不会停在原页）", () => {
    expect(page).toContain("const leaveWorkspace = (): void => { markBack(); leaveGuarded(goBack); };");
    expect(guard).toMatch(/entry\.released = true;\s*window\.removeEventListener\("popstate", entry\.pop\);/);
    expect(guard).toContain("if (typeof state.idx === \"number\" && state.idx > 0) window.history.go(-2);");
  });
});
