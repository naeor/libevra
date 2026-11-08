import { describe, expect, it } from "vitest";
import { hasOverlayScrollLock, lockOverlayScroll } from "./overlayScrollLock.js";

const target = (overflow = "") => ({ style: { overflow } }) as HTMLElement;
describe("弹窗滚动锁", () => {
  it.each([false, true])("叠层按任意顺序关闭，最后一层才恢复原值：逆序 %s", reverse => {
    const element = target("auto");
    const release = [lockOverlayScroll(element), lockOverlayScroll(element)];
    if (reverse) release.reverse();
    release[0]!();
    expect(element.style.overflow).toBe("hidden");
    release[1]!();
    expect(element.style.overflow).toBe("auto");
    expect(hasOverlayScrollLock(element)).toBe(false);
  });
  it("已先卸载的旧父面板恢复滚动后，不被子窗口重新锁住", () => {
    const element = target("hidden");
    const release = lockOverlayScroll(element);
    element.style.overflow = "";
    release();
    expect(element.style.overflow).toBe("");
  });
  it("旧父面板仍打开时保持它的锁；重复清理不影响新窗口", () => {
    const element = target("hidden");
    const release = lockOverlayScroll(element);
    release();
    const next = lockOverlayScroll(element);
    release();
    expect(hasOverlayScrollLock(element)).toBe(true);
    next();
    expect(element.style.overflow).toBe("hidden");
  });
});
