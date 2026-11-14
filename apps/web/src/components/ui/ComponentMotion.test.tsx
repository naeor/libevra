import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Alert } from "../Alert.js";
import { pageTransitionActive, Reveal } from "./ComponentMotion.js";
import { InlineMessage } from "./List.js";

/**
 * 1.19.76 公共动效基础：展开块 `Reveal`、内容切换 `useSwapReveal`、挂载即出现 `useMountReveal`。
 * 动画本身由 WAAPI 在浏览器里播放（运行中的应用逐帧核对）；这里锁住初次渲染的契约：
 * 初次挂载不入场、收起时不占位也不可聚焦、懒挂载、行内提示的播报角色不变。
 */
describe("展开块 Reveal", () => {
  it("一开始收起：hidden + inert，懒挂载时内容还不在 DOM 里", () => {
    const html = renderToStaticMarkup(<Reveal open={false}><button type="button">分类</button></Reveal>);
    expect(html).toBe('<div data-reveal="" hidden="" inert=""></div>');
  });

  it("不懒挂载时，收起状态也保留内容（仍然 hidden）", () => {
    const html = renderToStaticMarkup(<Reveal open={false} lazy={false}><span>内容</span></Reveal>);
    expect(html).toBe('<div data-reveal="" hidden="" inert=""><span>内容</span></div>');
  });

  it("一开始就打开：直接显示，不带 hidden / inert（初次挂载不入场）", () => {
    const html = renderToStaticMarkup(<Reveal open className="x"><span>内容</span></Reveal>);
    expect(html).toBe('<div class="x" data-reveal=""><span>内容</span></div>');
  });
});

describe("挂载即出现：行内提示", () => {
  it("Alert 与 InlineMessage 的播报角色不变（节点立即挂载）", () => {
    expect(renderToStaticMarkup(<Alert>保存失败</Alert>)).toContain('role="status"');
    expect(renderToStaticMarkup(<InlineMessage>网络错误</InlineMessage>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<InlineMessage tone="success">已保存</InlineMessage>)).toContain('role="status"');
  });

  it("两个公共出口都接了 useMountReveal", () => {
    const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
    expect(read("../Alert.tsx")).toMatch(/useMountReveal\(ref\)/);
    expect(read("./List.tsx")).toMatch(/useMountReveal\(boxRef\)/);
  });

  it("没有 DOM 时不认为有页面转场", () => {
    expect(pageTransitionActive()).toBe(false);
  });
});
