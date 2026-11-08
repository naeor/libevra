import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "../Button.js";
import { Card, ActionCard } from "../Card.js";
import { TextField } from "../TextField.js";
import { CapsuleButton, IconButton, Switch } from "./PurposeControls.js";
import { materialAttributes, materialCapability, materialTuningStyle } from "../../s19/material.js";

describe("标准组件用途与退化边界", () => {
  it("主要与危险操作拒绝透明候选，不改提交语义", () => {
    for (const role of ["primary", "danger", "danger-quiet"] as const) {
      const html = renderToStaticMarkup(<Button variant={role} appearance={{ finish: "lens", optics: "enhanced" }}>确认</Button>);
      expect(html).toContain(`data-material-role="${role}"`);
      expect(html).toContain('data-material-finish="auto"');
      expect(html).toContain('data-material-optics="stable"');
      expect(html).not.toContain('type="button"'); // 保留既有表单默认 submit
    }
  });
  it("加载是真禁用，既有自定义禁用外观不被材质覆盖", () => {
    const html = renderToStaticMarkup(<Button loading disabledClassName="custom-disabled">保存</Button>);
    expect(html).toContain('disabled=""'); expect(html).toContain('aria-busy="true"');
    expect(html).toContain("custom-disabled"); expect(html).not.toContain("data-material-role");
    expect(html).not.toContain("disabled:opacity-45");
  });
  it("显示容器与操作卡片有不同原生语义", () => {
    expect(renderToStaticMarkup(<ActionCard>详情</ActionCard>)).toMatch(/^<button type="button"/);
    expect(renderToStaticMarkup(<Card><Button>编辑</Button></Card>)).toMatch(/^<section/);
  });
  it("工具有名称，开关有受控状态，胶囊不请求模糊", () => {
    expect(renderToStaticMarkup(<IconButton label="更多">⋯</IconButton>)).toContain('aria-label="更多"');
    const toggle = renderToStaticMarkup(<Switch checked disabled onCheckedChange={() => undefined}>启用</Switch>);
    expect(toggle).toContain('aria-checked="true"'); expect(toggle).toContain('disabled=""');
    expect(renderToStaticMarkup(<CapsuleButton>账本</CapsuleButton>)).toContain('data-material-role="capsule"');
  });
  it("输入提示关联保留外部说明 id", () => {
    const html = renderToStaticMarkup(<TextField label="名称" hint="请输入" aria-describedby="external" />);
    expect(html).toMatch(/aria-describedby="external [^"]+-hint"/);
    expect(html).toContain('data-material-role="field"');
  });
  it("任意 DOM 不声称真实放大，局部参数有界且不改变三档存储", () => {
    expect(materialCapability("lens")).toMatchObject({ magnification: 1, target: 1.05, runtime: "css" });
    expect(materialCapability("frosted").magnification).toBe(1);
    expect(materialAttributes("field", { finish: "clear" })["data-material-finish"]).toBe("auto");
    const style = materialTuningStyle({ edge: Infinity, reflection: -4, radius: 900 }) as Record<string, unknown>;
    expect(style["--lv-material-edge"]).toBe(.45); expect(style["--lv-material-reflection"]).toBe(0); expect(style["--lv-material-radius"]).toBe("32px");
  });
});
