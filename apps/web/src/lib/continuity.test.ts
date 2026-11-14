import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1.19.82：“不连续使用”（应用离开屏幕超过 30 分钟）后，记住的滚动位置与面板状态重新开始（所有者 2026-11-15）。
 * node 环境：document / window 用最小替身，只验证规则本身。
 */
class FakeDocument extends EventTarget {
  hidden = false;
  elements = new Map<string, unknown>();
  querySelector(selector: string): unknown { return this.elements.get(selector) ?? null; }
}
const fakeDocument = new FakeDocument();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T10:00:00+08:00"));
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function away(minutes: number): void {
  fakeDocument.hidden = true;
  fakeDocument.dispatchEvent(new Event("visibilitychange"));
  vi.advanceTimersByTime(minutes * 60_000);
  fakeDocument.hidden = false;
  fakeDocument.dispatchEvent(new Event("visibilitychange"));
}

describe("连续使用", () => {
  it("离开 30 分钟以内回来不重置，超过才重置", async () => {
    const { onContinuityReset } = await import("./continuity.js");
    const reset = vi.fn();
    const off = onContinuityReset(reset);
    away(29);
    expect(reset).not.toHaveBeenCalled();
    away(31);
    expect(reset).toHaveBeenCalledTimes(1);
    off();
    away(60);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("面板状态：记在面板所在的那条历史记录上，取出前一直在；不连续使用后清空", async () => {
    const { rememberPanel, peekPanel, forgetPanel } = await import("./panelMemory.js");
    rememberPanel("entry-a", "book-notices:b1", { scrollTop: 320 });
    expect(peekPanel("entry-a", "book-notices:b1")).toEqual({ scrollTop: 320 });
    expect(peekPanel("entry-b", "book-notices:b1")).toBeNull();
    expect(peekPanel("entry-a", "book-notices:b2")).toBeNull();
    forgetPanel("entry-a", "book-notices:b1");
    expect(peekPanel("entry-a", "book-notices:b1")).toBeNull();
    rememberPanel("entry-a", "attachment-preview:b1:e1", { fileId: "f1" });
    away(45);
    expect(peekPanel("entry-a", "attachment-preview:b1:e1")).toBeNull();
  });

  it("滚动位置（协调器不接管的外观）：返回恢复、回到主 Tab 接上、打开新页面不动；不连续使用或换账号后重新开始", async () => {
    const pane = { scrollTop: 0 };
    const list = { scrollTop: 0 };
    fakeDocument.elements.set('.lv-pane[data-instance="w1"] > .lv-pane-scroll', { ...pane, querySelectorAll: () => [list], get scrollTop() { return pane.scrollTop; }, set scrollTop(v: number) { pane.scrollTop = v; } });
    vi.stubGlobal("window", { scrollY: 0, scrollTo: () => undefined });
    const { createScrollMemory } = await import("../workspace/scrollMemory.js");
    const memory = createScrollMemory("w1");
    memory.setAccount("u1");
    list.scrollTop = 480;
    memory.save("k-list", "/");
    list.scrollTop = 0;
    memory.restore("k-detail", "/transactions/1", "PUSH");
    expect(list.scrollTop).toBe(0);
    memory.restore("k-list", "/", "POP");
    expect(list.scrollTop).toBe(480);
    list.scrollTop = 0;
    memory.restore("k-new-tab", "/", "PUSH");
    expect(list.scrollTop).toBe(480);
    list.scrollTop = 0;
    away(40);
    memory.restore("k-list", "/", "POP");
    expect(list.scrollTop).toBe(0);
    list.scrollTop = 200;
    memory.save("k-list", "/");
    list.scrollTop = 0;
    memory.setAccount("u2");
    memory.restore("k-list", "/", "POP");
    expect(list.scrollTop).toBe(0);
    memory.dispose();
  });
});

describe("接线", () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
  it("协调器的滚动记忆在不连续使用后清空，返回关系不动", () => {
    const relations = read("../s19/motion/relations.ts");
    expect(relations).toContain("onContinuityReset(() => { for (const relations of live) { relations.scrolls.clear(); relations.tabScrolls.clear(); } });");
  });
  it("协调器不在时由工作区路由记住并恢复滚动", () => {
    const router = read("../workspace/PaneRouter.tsx");
    expect(router).toContain("scroll.current?.save(shown.current.location.key, shown.current.location.pathname);");
    expect(router).toContain("if (motion.current) { motion.current.committed(snapshot.location.key); return; }");
  });
  it("账本通知与附件预览：打开账目前记下面板状态，返回时重新打开", () => {
    const bell = read("../components/BookNotificationBell.tsx");
    expect(bell).toContain("rememberPanel(location.key, panelId, { scrollTop: body?.scrollTop ?? 0 });");
    expect(bell).toContain("useReopenPanel<{ scrollTop: number }>(panelId,");
    const attachments = read("../components/Attachments.tsx");
    expect(attachments).toContain("onOpenEntry={() => { rememberPanel(location.key, panelId, { fileId: preview.id }); }}");
    expect(attachments).toContain("useReopenPanel<{ fileId: string }>(panelId,");
  });
  it("应用里不用浏览器原生的确认 / 提示框（刷新、关闭标签页的 beforeunload 除外，网页换不掉）", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        if (/(window|globalThis|self)\.(confirm|alert|prompt)\(/.test(readFileSync(path, "utf8"))) offenders.push(path);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
