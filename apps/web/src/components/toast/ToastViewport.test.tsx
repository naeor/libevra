import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "../../i18n/index.js";
import { ToastController } from "../../lib/toast/controller.js";
import type { ToastView } from "../../lib/toast/types.js";
import { ToastProvider } from "./ToastProvider.js";
import { composeAnnouncement, reconcileDisplay, ToastViewport } from "./ToastViewport.js";

/**
 * 1.19.66 统一提示条宿主的渲染契约（无 DOM 的静态渲染）：播报区先在、内容后到；可见本体在“通知”区域里、
 * 不兼任播报区；操作与 × 都是 44px 的标准控件；类型靠字形与读屏前缀区分，不只靠颜色。
 */
function render(controller: ToastController<React.ReactNode>, kind: "phone" | "wide" | "desktop" = "phone"): string {
  return renderToStaticMarkup(
    <ToastProvider controller={controller}>
      <ToastViewport kind={kind} />
    </ToastProvider>,
  );
}

const undo = { label: "撤销", run: () => undefined, alternative: "编辑历史 → 已删除账目 →「恢复」" };

describe("提示条宿主", () => {
  it("没有提示时：两个播报区已经在 DOM 里且为空，没有可见区域", () => {
    const html = render(new ToastController());
    expect(html).toMatch(/<div class="sr-only" role="status" aria-live="polite" aria-atomic="true"><\/div>/);
    expect(html).toMatch(/<div class="sr-only" role="alert" aria-live="assertive" aria-atomic="true"><\/div>/);
    expect(html).not.toContain("lv-toast-region");
  });

  it("带撤销的提示：在“通知”区域里，有 44px 的操作胶囊与 ×；本体没有 aria-live / role=status", () => {
    const controller = new ToastController<React.ReactNode>();
    controller.show({ text: "已删除这笔记账", action: undo });
    const html = render(controller);
    expect(html).toContain(`<section class="lv-toast-region" aria-label="${t("common.toast.region")}">`);
    expect(html).toContain('data-toast-surface=""');
    expect(html).toContain('data-tone="info"');
    expect(html).toMatch(/lv-capsule-button[^"]*lv-toast-action/);
    expect(html).toContain(">撤销<");
    expect(html).toMatch(/aria-label="关闭提示"[^>]*class="[^"]*lv-icon-button/);
    const region = html.slice(html.indexOf("<section"));
    expect(region).not.toContain("aria-live");
    expect(region).not.toContain('role="status"');
    expect(region).not.toContain('role="alert"');
  });

  it("四种类型的字形不同；只有错误与带操作的提示有 ×", () => {
    const paths = new Set<string>();
    for (const tone of ["info", "success", "warning", "error"] as const) {
      const controller = new ToastController<React.ReactNode>();
      controller.show({ tone, text: "示例" });
      const html = render(controller);
      expect(html).toContain(`data-tone="${tone}"`);
      const path = /class="lv-toast-glyph-mark"[^>]*d="([^"]+)"|d="([^"]+)"[^>]*class="lv-toast-glyph-mark"/.exec(html);
      paths.add(path?.[1] ?? path?.[2] ?? "");
      expect(html.includes("lv-toast-close")).toBe(tone === "error");
    }
    expect(paths.size).toBe(4);
  });

  it("前置图（头像）代替类型图标", () => {
    const controller = new ToastController<React.ReactNode>();
    controller.show({ text: "获得新头像", leading: <span className="avatar-probe" />, action: { ...undo, label: "查看" } });
    const html = render(controller);
    expect(html).toContain('data-leading=""');
    expect(html).toContain("avatar-probe");
    expect(html).not.toContain("lv-toast-glyph");
  });

  it("让开时（弹层打开）不渲染可见本体", () => {
    const controller = new ToastController<React.ReactNode>();
    controller.show({ tone: "success", text: "已保存" });
    controller.setPause("yield", true);
    expect(render(controller)).not.toContain("lv-toast-region");
  });

  it("Pad 宽屏与电脑版：同一个组件，宿主标出种类", () => {
    const controller = new ToastController<React.ReactNode>();
    controller.show({ tone: "success", text: "已保存" });
    expect(render(controller, "wide")).toContain('data-toast-host="wide"');
    expect(render(controller, "desktop")).toContain('data-toast-host="desktop"');
  });

  it("读屏文字：警告 / 错误加前缀，带操作说明可做什么", () => {
    expect(composeAnnouncement({ serial: 1, text: "放不下", politeness: "status", tone: "warning", detail: undefined, actionLabel: undefined }, t)).toBe("警告：放不下");
    expect(composeAnnouncement({ serial: 1, text: "保存失败", politeness: "alert", tone: "error", detail: "编辑内容已保留。", actionLabel: undefined }, t)).toBe(
      "错误：保存失败 编辑内容已保留。",
    );
    expect(composeAnnouncement({ serial: 1, text: "已删除这笔记账", politeness: "status", tone: "info", detail: undefined, actionLabel: "撤销" }, t)).toBe(
      "已删除这笔记账 可撤销",
    );
  });
});

describe("宿主渲染哪几条（reconcileDisplay）", () => {
  const view = (slot: number, appearance = 1, revision = 0): ToastView<React.ReactNode> => ({
    id: slot * 100 + revision,
    slot,
    appearance,
    revision,
    tone: "info",
    text: `第 ${String(slot)} 条`,
    detail: undefined,
    leading: undefined,
    action: undefined,
    closable: false,
    echo: false,
  });
  const empty = { current: null, leaving: [] };

  it("出现、替换（旧的一条退场）、消失", () => {
    const first = reconcileDisplay(empty, view(1));
    expect(first.current?.key).toBe("1:1");
    const replaced = reconcileDisplay(first, view(2));
    expect(replaced.current?.key).toBe("2:1");
    expect(replaced.leaving.map((item) => item.key)).toEqual(["1:1"]);
    const gone = reconcileDisplay(replaced, null);
    expect(gone.current).toBeNull();
    expect(gone.leaving.map((item) => item.key)).toEqual(["1:1", "2:1"]);
  });

  it("合并（同槽位、合并次数变化）：只换内容，不换 key、不重播入场", () => {
    const first = reconcileDisplay(empty, view(1));
    const merged = reconcileDisplay(first, view(1, 1, 1));
    expect(merged.current?.key).toBe("1:1");
    expect(merged.current?.view.revision).toBe(1);
    expect(merged.leaving).toEqual([]);
    expect(reconcileDisplay(merged, merged.current!.view)).toBe(merged);
  });

  it("让开后再出现：新的 key，重播入场", () => {
    const first = reconcileDisplay(empty, view(1));
    const hidden = reconcileDisplay(first, null);
    const back = reconcileDisplay(hidden, view(1, 2));
    expect(back.current?.key).toBe("1:2");
  });
});
