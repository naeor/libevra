import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PaneSizeContext, PaneSizeStore } from "../workspace/context.js";
import { Drawer } from "./Drawer.js";
import { drawerGeometry, drawerModeFor } from "./drawerLayout.js";
import type { DragController } from "./dnd.js";

describe("浮动工具面板按所属工作区适配", () => {
  it("宽工作区限宽，窄工作区留边；上限保留顶栏空间", () => {
    for (const width of [240, 320, 360, 419, 420, 700, 1024, 1500]) {
      for (const height of [0, 120, 240, 390, 540, 900, 1180]) {
        const box = drawerGeometry(width, height);
        expect(box.width).toBeLessThanOrEqual(Math.max(0, width - 24));
        expect(box.width).toBeLessThanOrEqual(440);
        expect(box.expanded).toBeLessThanOrEqual(Math.max(0, height - 80));
        expect(box.collapsed).toBeLessThanOrEqual(box.expanded);
      }
    }
    expect(drawerGeometry(1100, 820)).toEqual({ width: 440, expanded: 448, collapsed: 52 });
    expect(drawerGeometry(320, 240)).toEqual({ width: 296, expanded: 160, collapsed: 52 });
  });

  it("连续调整分隔线时有迟滞，不在420/700附近反复换档", () => {
    let mode = drawerModeFor(390);
    for (const width of [419, 421, 418, 430]) mode = drawerModeFor(width, mode);
    expect(mode).toBe("narrow");
    mode = drawerModeFor(440, mode);
    expect(mode).toBe("medium");
    expect(drawerModeFor(419, mode)).toBe("medium");
    expect(drawerModeFor(400, mode)).toBe("narrow");
    expect(drawerModeFor(720, mode)).toBe("wide");
    expect(drawerModeFor(699, "wide")).toBe("wide");
    expect(drawerModeFor(680, "wide")).toBe("medium");
  });

  it("只依据传入工作区尺寸；横屏窄副区与竖屏矮上区独立计算", () => {
    expect(drawerGeometry(330, 820).width).toBe(306);
    expect(drawerGeometry(900, 240).expanded).toBe(160);
    expect(drawerModeFor(330)).toBe("narrow");
    expect(drawerModeFor(900)).toBe("wide");
  });
});

const noop = () => undefined;
const drag: DragController = { drag: null, sourceProps: () => ({ onPointerDown: noop, onContextMenu: noop }), consumeClick: () => false, cancel: noop };

function markup(height: "collapsed" | "expanded", width = 320, paneHeight = 640): string {
  const store = new PaneSizeStore();
  store.set(width, paneHeight);
  return renderToStaticMarkup(<PaneSizeContext.Provider value={store}><Drawer height={height} onHeight={noop} combined={false} drag={drag} onAddCard={noop} onAddLayout={noop} onCustom={noop} containerScope={null} onScopeAdd={noop} onScopeMove={noop} onScopeRemove={noop} onScopeDone={noop} onScopeCancel={noop} onPresets={noop} /></PaneSizeContext.Provider>);
}

describe("同一份卡片库保留功能与收起语义", () => {
  it("收起保留来源DOM，但隐藏内容不可聚焦；保留卡片、容器和预设入口", () => {
    const html = markup("collapsed");
    expect(html).toContain('class="sw-drawer-body" inert="" aria-hidden="true"');
    expect(html).toContain('data-drawer-opener="true"');
    expect(html).toContain('sw-draggable');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('sw-drawer-toolbar');
    expect(html).toContain('data-mode="narrow"');
  });

  it("宽区与矮区使用各自尺寸，不生成三套卡片库", () => {
    const wide = markup("expanded", 1200, 820);
    const short = markup("expanded", 900, 240);
    expect(wide).toContain('--sw-library-width:440px');
    expect(short).toContain('--sw-drawer-max:160px');
    expect(wide.match(/class="sw-drawer-body"/g)).toHaveLength(1);
    expect(wide).toContain('data-mode="wide"');
  });
});
