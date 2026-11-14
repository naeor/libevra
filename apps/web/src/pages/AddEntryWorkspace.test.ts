import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 1.19.78 / 1.19.81 / 1.19.82：手动记账是独立工作区；顶栏返回与系统返回一致（所有者 2026-11-15：
 * “它要拦我们的返回，那当然也要拦系统的返回”）；所有外观都在有改动时先问（“所有的记账方式退出时都要问放弃”）。
 * 系统返回的保护记录需要浏览器，这里锁住接线。
 */
const page = readFileSync(new URL("./AddEntryPage.tsx", import.meta.url), "utf8");
const guard = readFileSync(new URL("../lib/closeGuard.ts", import.meta.url), "utf8");

describe("记账工作区的返回", () => {
  it("顶栏返回与系统返回用同一个“未保存”判断、同一个询问", () => {
    expect(page).toContain("const dirty = amountText.trim() !== \"\" || note.trim() !== \"\" || attachments.files.length > 0;");
    expect(page).toContain("const leave = useLeaveConfirm(dirty && saved === null, goBack, { links: true });");
    expect(page).toContain("<WorkspaceTopBar title={t(\"workspace.rail.add\")} onBack={leave.requestLeave} />");
    expect(page).toContain("{...leave.dialog}");
    expect(guard).toContain("const leaveGuarded = usePageBackGuard(dirty, () => { target.current = null; setAsking(true); });");
  });

  it("确认放弃后经保护记录离开（不会被自己再拦一次，也不会停在原页）", () => {
    expect(guard).toContain("const leaveNow = useCallback(() => { markBack(); leaveGuarded(latest.current.leave); }, [leaveGuarded, markBack]);");
    expect(guard).toMatch(/entry\.released = true;\s*window\.removeEventListener\("popstate", entry\.pop\);/);
    expect(guard).toContain("if (typeof state.idx === \"number\" && state.idx > 0) window.history.go(-2);");
  });
});

describe("离开前询问的统一做法（useLeaveConfirm）", () => {
  it("没有改动直接离开，有改动先问", () => {
    expect(guard).toContain("if (latest.current.dirty) { target.current = null; setAsking(true); } else leaveNow();");
  });

  it("去别处（链接确认、流程下一步）先退掉保护记录、回到这一页再前往，浏览器历史与没有询问时一样", () => {
    expect(guard).toContain("if (released) { released(true); return; }");
    expect(guard).toContain("afterBackGuard(leaveGuarded, action)");
    expect(guard).toContain("discardHere(() => { void navigate(to); });");
    expect(guard).toContain("discardHere(() => { void navigate(path, options); });");
  });

  it("链接拦截只认本工作区、同源、普通点击", () => {
    expect(guard).toContain("if (owner !== null && owner !== undefined && owner !== instance) return;");
    expect(guard).toContain("if (url.origin !== window.location.origin) return;");
    expect(guard).toContain("event.metaKey || event.ctrlKey || event.shiftKey || event.altKey");
  });
});
