import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OceanBackdrop } from "../components/OceanBackdrop.js";
import { MATERIAL_DEFAULTS } from "./material.js";
import { OceanMaterial, type OceanLook } from "./OceanMaterial.js";

describe("开始页面海浪：Original 原样，S19 四风格只换绘制", () => {
  it("Original（无风格属性）仍是原版 SVG，四个主题色以字面量引用（Tailwind 才会输出变量）", () => {
    const html = renderToStaticMarkup(<OceanBackdrop />);
    expect(html.match(/<path /g)).toHaveLength(4);
    for (const k of [1, 2, 3, 4]) expect(html).toContain(`fill="var(--color-ocean-${k})"`);
    expect(html).not.toContain("<canvas");
  });

  it.each<OceanLook>(["a", "b1", "b2", "c"])("%s：只有一张固定画布（没有另叠的光斑层），不使用滤镜、遮罩或裁切", look => {
    const html = renderToStaticMarkup(<OceanMaterial look={look} interactive={false} />);
    expect(html.match(/<canvas /g)).toHaveLength(1);
    expect(html).not.toMatch(/filter|mask|clip-path|clipPath/);
    expect(html.match(/data-ocean-brand="large"/g)).toHaveLength(1);
    expect(html.match(/data-ocean-brand="compact"/g)?.length ?? 0).toBe(look === "b1" || look === "b2" ? 1 : 0);
    expect(html).toContain(`data-ocean-look="${look}"`);
    expect(html).toContain(`--lv-material-reflection:${MATERIAL_DEFAULTS.reflection}`);
  });

  it("装饰层不进入辅助技术树，真实账号入口不被隐藏或复制", () => {
    const html = renderToStaticMarkup(<OceanMaterial look="b2" interactive><button type="button">账号入口</button></OceanMaterial>);
    expect(html).toContain('class="space-ocean space-ocean-live"');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toMatch(/class="space-ocean space-ocean-live"[^>]*aria-hidden/);
    expect(html.match(/<canvas[^>]*aria-hidden="true"/g)).toHaveLength(1);
  });
});
